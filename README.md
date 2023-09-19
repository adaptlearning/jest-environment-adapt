# jest-environment-adapt

Setup jest using jsdom. Support Adapt plugin mocking. Allow jsdom to load resources from Adapt's build output. Fix missing apis on jsdom window. Force jest to wait for Adapt to load correctly.

Supports loading Adapt into a node jsdom environment for unit testing.

### Config in `jest.config.json`
```json
{
  "testEnvironment": "jest-environment-adapt",
  "testEnvironmentOptions": {
    "pluginsMockFile": "./test/unit/__mocks__/plugins.js"
  }
}
```

### Programmic config
```js
  const config = require('./jest.config');
  config.testEnvironmentOptions.outputDir = "./build/";
```
