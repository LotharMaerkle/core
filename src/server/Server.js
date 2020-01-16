/*
Copyright 2019 Javier Brea
Copyright 2019 XbyOrange

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
*/

"use strict";

const http = require("http");

const express = require("express");
const { delay } = require("lodash");
const tracer = require("../tracer");
const middlewares = require("./middlewares");

class Server {
  constructor(eventEmitter, settings, mocks, core) {
    // TODO, deprecate, the core is being passed only to maintain temporarily backward retrocompaitbility with API plugin. This is not published in documentation.
    this._core = core; // Use this reference only to provide it to external functions for customization purposes
    this._mocks = mocks;
    this._eventEmitter = eventEmitter;
    this._customRouters = [];
    this._settings = settings;
    this._error = null;

    this._startServer = this._startServer.bind(this);
  }

  init() {
    process.on("SIGINT", () => {
      this.stop().then(() => {
        tracer.info("Server closed");
      });
      process.exit();
    });
    return Promise.resolve();
  }

  _initServer() {
    if (this._serverInitted) {
      return;
    }
    tracer.debug("Initializing server");
    this._serverInitted = true;
    this._express = express();

    // Add middlewares
    this._express.use(middlewares.addRequestId);
    this._express.use(middlewares.enableCors);
    this._express.use(middlewares.addCommonHeaders);
    this._express.options("*", middlewares.enableCors);
    this._express.use(middlewares.jsonBodyParser);
    this._express.use(middlewares.traceRequest);
    this._registerCustomRouters();
    this._express.use(this._fixturesMiddleware.bind(this));
    this._express.use(middlewares.notFound);
    this._express.use(middlewares.errorHandler);

    // Create server
    this._server = http.createServer(this._express);

    this._server.on("error", error => {
      tracer.error(`Server error: ${error.message}`);
      this._error = error;
      throw error;
    });
  }

  _reinitServer() {
    if (this._serverInitted) {
      this._serverInitted = false;
      if (this._serverStarted) {
        return this.restart();
      }
      if (this._serverStarting) {
        return this._serverStarting.then(() => {
          return this.restart();
        });
      }
    }
    return Promise.resolve();
  }

  _startServer(resolve, reject) {
    const host = this._settings.get("host");
    const port = this._settings.get("port");
    const hostName = host === "0.0.0.0" ? "localhost" : host;

    try {
      this._server.listen(
        {
          port,
          host
        },
        error => {
          if (error) {
            tracer.error(`Error starting server: ${error.message}`);
            this._serverStarting = false;
            this._serverStarted = false;
            this._error = error;
            reject(error);
          } else {
            tracer.info(`Server started and listening at http://${hostName}:${port}`);
            this._error = null;
            this._serverStarting = false;
            this._serverStarted = true;
            resolve(this);
          }
        }
      );
    } catch (error) {
      reject(error);
    }
  }

  _registerCustomRouters() {
    tracer.debug("Adding custom routers to server");
    this._customRouters.forEach(customRouter => {
      tracer.silly(`Adding custom router with path ${customRouter.path}`);
      this._express.use(customRouter.path, customRouter.router);
    });
  }

  _fixturesMiddleware(req, res, next) {
    const fixture = this._mocks.behaviors.current.getRequestMatchingFixture(req);
    if (fixture) {
      delay(() => {
        // TODO, deprecate passing the core to handlers. Fixtures handlers already have a reference that is passed to the constructor.
        fixture.handleRequest(req, res, next, this._core);
      }, this._settings.get("delay"));
    } else {
      next();
    }
  }

  stop() {
    if (this._serverStopping) {
      return this._serverStopping;
    }
    if (this._server) {
      this._serverStopping = new Promise(resolve => {
        tracer.verbose("Stopping server");
        this._server.close(() => {
          tracer.info("Server stopped");
          this._serverStarted = false;
          this._serverStopping = false;
          resolve();
        });
      });
      return this._serverStopping;
    }
    return Promise.resolve();
  }

  async start() {
    this._initServer();
    if (this._serverStarting) {
      tracer.debug("Server is already starting, returning same promise");
      return this._serverStarting;
    }
    this._serverStarting = new Promise(this._startServer);
    return this._serverStarting;
  }

  _getCustomRouterIndex(path, router) {
    let routerIndex = null;
    this._customRouters.forEach((customRouter, index) => {
      if (customRouter.path === path && customRouter.router === router) {
        routerIndex = index;
      }
    });
    return routerIndex;
  }

  addCustomRouter(path, router) {
    this._customRouters.push({
      path,
      router
    });
    return this._reinitServer();
  }

  removeCustomRouter(path, router) {
    let indexToRemove = this._getCustomRouterIndex(path, router);
    if (indexToRemove !== null) {
      this._customRouters.splice(indexToRemove, 1);
      return this._reinitServer();
    }
    return Promise.resolve();
  }

  async restart() {
    await this.stop();
    return this.start();
  }

  get error() {
    return this._error;
  }
}

module.exports = Server;