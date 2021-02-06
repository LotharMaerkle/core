/*
Copyright 2019 Javier Brea

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
*/

const path = require("path");

const crossFetch = require("cross-fetch");
const waitOn = require("wait-on");

const { Core } = require("../../../../index");
const MocksRunner = require("./MocksRunner");

const SERVER_PORT = 3100;
const DEFAULT_BINARY_PATH = "./starter";

const defaultOptions = {
  port: SERVER_PORT,
  log: "debug",
  watch: false,
};

const defaultRequestOptions = {
  method: "GET",
  headers: {
    "Content-Type": "application/json",
  },
};

const fixturesFolder = (folderName) => {
  return path.resolve(__dirname, "..", "fixtures", folderName);
};

const startCore = (mocksPath, options = {}) => {
  const mocks = mocksPath || "web-tutorial";
  const core = new Core({
    onlyProgrammaticOptions: true,
    plugins: options.plugins,
  });

  return core
    .init({
      ...defaultOptions,
      path: fixturesFolder(mocks),
      ...options,
    })
    .then(() => {
      return core.start().then(() => {
        return Promise.resolve(core);
      });
    });
};

const stopCore = (core) => {
  return core.stop();
};

const serverUrl = (port) => {
  return `http://localhost:${port || SERVER_PORT}`;
};

const fetch = (uri, options = {}) => {
  const requestOptions = {
    ...defaultRequestOptions,
    ...options,
  };

  return crossFetch(`${serverUrl(options.port)}${uri}`, {
    ...requestOptions,
  }).then((res) => {
    return res.json().then((processedRes) => ({ body: processedRes, status: res.status }));
  });
};

class TimeCounter {
  constructor() {
    this._startTime = new Date();
  }

  _getMiliseconds() {
    this._miliseconds = this._endTime - this._startTime;
  }

  get total() {
    return this._miliseconds;
  }

  stop() {
    this._endTime = new Date();
    this._getMiliseconds();
  }
}

const wait = (time = 1000) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve();
    }, time);
  });
};

const waitForServer = (port) => {
  return waitOn({ resources: [`tcp:localhost:${port || SERVER_PORT}`] });
};

const mocksRunner = (args = [], binary = DEFAULT_BINARY_PATH) => {
  const argsToSend = [...args];
  argsToSend.unshift(binary);
  return new MocksRunner(argsToSend);
};

module.exports = {
  startCore,
  stopCore,
  fetch,
  TimeCounter,
  MocksRunner,
  mocksRunner,
  wait,
  waitForServer,
  fixturesFolder,
};
