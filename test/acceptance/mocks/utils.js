/*
Copyright 2019 Javier Brea

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
*/

const path = require("path");

const requestPromise = require("request-promise");
const { Server } = require("../../../index");

const SERVER_PORT = 3100;

const defaultOptions = {
  port: SERVER_PORT,
  log: "debug",
  watch: true
};

const defaultRequestOptions = {
  method: "GET"
};

const startServer = (mocksPath, options = {}) => {
  const server = new Server(path.resolve(__dirname, "fixtures", "web-tutorial"), {
    ...defaultOptions,
    ...options
  });
  return server.start().then(() => {
    return Promise.resolve(server);
  });
};

const request = (uri, options = {}) => {
  const requestOptions = {
    ...defaultRequestOptions,
    ...options
  };

  return requestPromise({
    uri: `http://localhost:${SERVER_PORT}${uri}`,
    json: true,
    ...requestOptions
  });
};

const changeBehavior = behavior => {
  return request("/mocks/behaviors/current", {
    method: "PUT",
    body: {
      name: behavior
    }
  });
};

const getBehaviors = () => {
  return request("/mocks/behaviors");
};

module.exports = {
  startServer,
  request,
  changeBehavior,
  getBehaviors
};
