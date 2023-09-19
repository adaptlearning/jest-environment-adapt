import fs from 'fs-extra';
import path from 'path';
import { TestEnvironment } from 'jest-environment-jsdom';
import jsdom from 'jsdom';

const url = 'https://example.org/';

class CustomResourceLoader extends jsdom.ResourceLoader {

  constructor(options) {
    super(options);
    this.options = options;
  }

  fetch(resourceUrl, options) {
    const outputDir = this.options.outputDir.replace(/\\/g, '/');
    if (resourceUrl.startsWith(url)) {
      const resourcePath = resourceUrl.slice(url.length);
      if (!['libraries/require.min.js'].includes(resourcePath) && resourcePath.startsWith('libraries/')) {
        const library = fs.readFileSync(path.join(outputDir, resourcePath));
        const instance = CustomEnvironment.getInstance()
        if (instance) {
          // Hack to define moduleIds for unnamed define statements
          instance.dom.window.moduleId = resourcePath;
        }
        return Promise.resolve(library);
      }
      if (resourcePath === 'adapt/js/adapt.min.js') {
        // Signal to start tests
        return Promise.resolve('window.__JEST_LOAD_ADAPT = true');
      }
      return fs.readFile(path.join(outputDir, resourcePath));
    }
    return super.fetch(resourceUrl, options);
  }
}

class CustomEnvironment extends TestEnvironment {
  constructor(options, context) {
    const virtualConsole = new jsdom.VirtualConsole();
    virtualConsole.sendTo(console);
    const opt = { ...options, projectConfig: { ...options.projectConfig } }
    const testEnvironmentOptions = opt.projectConfig.testEnvironmentOptions;
    const outputDir = testEnvironmentOptions.outputDir.replace(/\\/g, '/');
    opt.projectConfig.testEnvironmentOptions = {
      ...testEnvironmentOptions,
      html: fs.readFileSync(path.join(outputDir, 'index.html')).toString(),
      url: url + '#/',
      pretendToBeVisual: true,
      runScripts: 'dangerously',
      resources: new CustomResourceLoader(testEnvironmentOptions),
      virtualConsole
    };
    super(opt, context);
    this.testEnvironmentOptions = opt.projectConfig.testEnvironmentOptions;
    this.url = url
    CustomEnvironment._instance = this;
  }

  static getInstance() {
    return this._instance;
  }

  async setup() {
    await super.setup();
    await this.mockPlugins();
    await this.redirectXMLHttpRequest();
    await this.fakeOnScroll();
    await this.adaptFoundations();
  }

  async mockPlugins() {
    const outputDir = this.testEnvironmentOptions.outputDir.replace(/\\/g, '/');
    const buildJSON = fs.readJSONSync(path.join(outputDir, 'adapt/js/build.min.js'));
    const getPluginType = plugin => {
      return ['component', 'extension', 'menu', 'theme'].find(type => {
        return (plugin[type] || plugin.keywords?.includes(`adapt-${type}`));
      });
    };
    const pluginsMock = [];
    for (const plugin of buildJSON.plugins) {
      if (!plugin.main) continue;
      const type = getPluginType(plugin);
      const addS = ['component', 'extension'].includes(type);
      if (plugin.main[0] !== '/') plugin.main = `/${plugin.main}`;
      pluginsMock.push(`import '${type}${addS ? 's' : ''}/${plugin.name}${plugin.main}';`);
    }
    const { pluginsMockFile } = this.testEnvironmentOptions;
    fs.writeFileSync(pluginsMockFile, pluginsMock.join('\n') + '\n');
  }

  async redirectXMLHttpRequest(window = this.dom.window) {
    const outputDir = this.testEnvironmentOptions.outputDir.replace(/\\/g, '/');
    window.XMLHttpRequest = function() {
      this._callbacks = {
        onload: [],
        onerror: [],
        onabort: [],
        ontimeout: [],
        onreadystatechange: []
      };
      this._readyState = 0;
      this._status = 0;
      this._statusText = '';
    };
    window.XMLHttpRequest.prototype = {
      open: function(method, url) {
        this.method = method;
        this.url = url;
        this._readyState = 1;
        this.trigger('onreadystatechange');
      },
      trigger(name) {
        this._callbacks[name].forEach(c => c(this));
      },
      get withCredentials () {
        return true;
      },
      send: async function() {
        const data = (await fs.readFile(path.join(outputDir, this.url))).toString();
        this._responseText = data;
        this._readyState = 4;
        this._status = 200;
        this._statusText = 'OK';
        this._responseType = 'text';
        this.trigger('onreadystatechange');
        this.trigger('onload');
      },
      overrideMimeType: function() {},
      setRequestHeader: function() {},
      getAllResponseHeaders: function() {
        return {};
      },
      addCallback(name, callback) {
        this._callbacks[name].push(callback);
      },
      get onload () {},
      set onload (callback) {
        this.addCallback('onload', callback);
      },
      get onreadystatechange () {},
      set onreadystatechange (callback) {
        this.addCallback('onreadystatechange', callback);
      },
      get onerror () {},
      set onerror (callback) {
        this.addCallback('onerror', callback);
      },
      get onabort () {},
      set onabort (callback) {
        this.addCallback('onabort', callback);
      },
      get ontimeout () {},
      set ontimeout (callback) {
        this.addCallback('ontimeout', callback);
      },
      get status() {
        return this._status;
      },
      get statusText() {
        return this._statusText;
      },
      get statusCode() {},
      get response() {
        try {
          if (this._responseType === 'json') {
            return JSON.parse(this.responseText);
          }
        } catch (err) {
          return this.responseText;
        }
      },
      set responseType(value) {
        this._responseType = value;
      },
      get responseType() {
        return this._responseType;
      },
      get responseText() {
        return this._responseText;
      },
      get readyState() {
        return this._readyState ?? 0;
      }
    };
  }

  async fakeOnScroll(window = this.dom.window) {
    window.scrollTo = (x, y) => {};
  }

  async adaptFoundations(window = this.dom.window) {
    // wait for html, scriptloader and globals libraries/ to load
    await new Promise((resolve, reject) => {
      const a = setInterval(() => {
        if (!window.require) return;
        if (!window.__JEST_LOAD_ADAPT) return;
        clearInterval(a);
        resolve(Promise.resolve());
      }, 250);
    });
    await this.fixDefine();
  }

  async fixDefine(window = this.dom.window) {
    const rjsDefine = window.define
    this.global.this = window;
    global.define = this.global.define = window.define = function FIXDEFINE(...args) {
      const callback = args.find(arg => typeof arg === 'function');
      const deps = args.find(arg => Array.isArray(arg));
      let name = args.find(arg => typeof arg === 'string');
      if (!name && window.moduleId) {
        args.unshift(window.moduleId);
      }
      rjsDefine(...args);
    }
    const arequire = this.global.require;
    const rjsRequire = window.require;
    global.require = this.global.require = window.require = function FIXREQUIRE(...args) {
      const deps = args.find(arg => Array.isArray(arg));
      if (!deps?.some(dep => dep.includes('libraries/'))) return arequire(...args);
      rjsRequire(...args);
    }
  }
}

export default CustomEnvironment;
