/*
Copyright 2021 Javier Brea

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
*/

const express = require("express");
const { flatten } = require("lodash");
const tracer = require("../tracer");

const Mock = require("./Mock");

const DEFAULT_ROUTES_HANDLER = "default";

function filterMockRoutes(mockRoutes, nextRoutes) {
  return mockRoutes.filter((mockRoute) => {
    return !nextRoutes.find((nextRoute) => {
      return mockRoute.routeId === nextRoute.routeId;
    });
  });
}

function getMockRoutes(mock, mocks, routes, nextRoutes = []) {
  const mockRoutes = mock.routes
    .map((routeId) => {
      const mockRoute = routes.find((route) => route.variantId === routeId);
      if (!mockRoute) {
        // TODO, add alert
      }
      return mockRoute;
    })
    .filter((route) => !!route);
  if (mock.from) {
    const from = mocks.find((mockCandidate) => mockCandidate.id === mock.from);
    return getMockRoutes(
      from,
      mocks,
      routes,
      filterMockRoutes(mockRoutes, nextRoutes).concat(nextRoutes)
    );
  }
  return filterMockRoutes(mockRoutes, nextRoutes).concat(nextRoutes);
}

function getVariantId(routeId, variantId) {
  return `${routeId}:${variantId}`;
}

class Mocks {
  constructor(
    {
      getLoadedMocks,
      getLoadedRoutes,
      getCurrentMock,
      getDelay,
      onChange,
      addAlert,
      removeAlerts,
    },
    core
  ) {
    this._getLoadedMocks = getLoadedMocks;
    this._getLoadedRoutes = getLoadedRoutes;
    this._getCurrentMock = getCurrentMock;
    this._getDelay = getDelay;
    this._onChange = onChange;
    this._addAlert = addAlert;
    this._removeAlerts = removeAlerts;
    this._core = core;

    this._router = null;
    this._mocksDefinitions = [];
    this._mocks = [];
    this._plainMocks = [];
    this._routesDefinitions = [];
    this._plainRoutes = [];
    this._plainRoutesVariants = [];
    this._routes = [];
    this._customVariants = [];
    this._customVariantsMock = null;

    this.router = this.router.bind(this);
  }

  _reloadRouter() {
    if (this._customVariantsMock) {
      this._router = this._customVariantsMock.router;
    } else if (this._currentMock) {
      this._router = this._currentMock.router;
    } else {
      this._router = express.Router();
    }
  }

  _processMocks() {
    tracer.debug("Processing loaded mocks");
    let errorsProcessing = 0;
    this._mocks = this._mocksDefinitions
      .map((mockDefinition) => {
        try {
          return new Mock({
            id: mockDefinition.id,
            routes: getMockRoutes(mockDefinition, this._mocksDefinitions, this._routes),
            getDelay: this._getDelay,
          });
        } catch (err) {
          errorsProcessing++;
          tracer.error("Error processing mock");
          return null;
        }
      })
      .filter((mock) => !!mock);
    if (errorsProcessing > 0) {
      this._addAlert("process:mocks", `${errorsProcessing} errors found while loading mocks`);
    } else {
      this._removeAlerts("process:mocks");
    }
  }

  _processPlainMocks() {
    this._plainMocks = this._mocks.map((mock) => {
      return {
        id: mock.id,
        routes: mock.routes.map((route) => route.variantId),
      };
    });
  }

  _processRoutes() {
    tracer.debug("Processing loaded routes");
    this._routes = flatten(
      this._routesDefinitions.map((route) => {
        // TODO, validate and handle errors
        return route.variants.map((variant) => {
          const variantId = getVariantId(route.id, variant.id);
          const handlerId = variant.handler || DEFAULT_ROUTES_HANDLER;
          const Handler = this._routesHandlers.find(
            (routeHandler) => routeHandler.id === handlerId
          );
          const routeHandler = new Handler(
            {
              ...variant,
              variantId,
              url: route.url,
              method: route.method,
            },
            this._core
          );
          routeHandler.delay = variant.hasOwnProperty("delay")
            ? variant.delay
            : route.hasOwnProperty("delay")
            ? route.delay
            : null;
          routeHandler.id = variant.id;
          routeHandler.variantId = variantId;
          routeHandler.routeId = route.id;
          routeHandler.url = route.url;
          routeHandler.method = route.method;
          return routeHandler;
          // TODO, check that handler exists, if not, add a warning
        });
      })
    ).filter((route) => !!route);
  }

  _processPlainRoutes() {
    this._plainRoutes = this._routesDefinitions.map((route) => {
      return {
        id: route.id,
        url: route.url,
        method: route.method,
        delay: route.delay,
        variants: route.variants
          .map((variant) => {
            const variantId = getVariantId(route.id, variant.id);
            const variantHandler = this._routes.find((route) => route.variantId === variantId);
            if (variantHandler) {
              return variantId;
            }
          })
          .filter((variant) => !!variant),
      };
    });
  }

  _processPlainRoutesVariants() {
    this._plainRoutesVariants = this._routes.map((routeVariant) => {
      return {
        id: routeVariant.variantId,
        routeId: routeVariant.routeId,
        handler: routeVariant.constructor.id,
        response: routeVariant.plainResponsePreview,
        delay: routeVariant.delay,
      };
    });
  }

  load() {
    // TODO, validate
    this._routesDefinitions = this._getLoadedRoutes();
    this._mocksDefinitions = this._getLoadedMocks();
    this._processRoutes();
    this._processPlainRoutes();
    this._processPlainRoutesVariants();
    this._processMocks();
    this._processPlainMocks();
    this.current = this._getCurrentMock();
    this._onChange();
  }

  init(routesHandlers) {
    this._routesHandlers = routesHandlers;
  }

  router(req, res, next) {
    this._router(req, res, next);
  }

  set current(id) {
    tracer.verbose(`Trying to set current mock as "${id}"`);
    let current;
    this._removeAlerts("current:settings");
    if (!id) {
      current = this._mocks[0];
      tracer.warn(`Option "mock" was not defined`);
      if (current) {
        this._addAlert(
          "current:settings",
          `"mock" option was not defined. Using the first one found`
        );
        tracer.info(`Using first found mock: "${current.id}"`);
      } else {
        this._addAlert("current:settings", `"mock" option was not defined`);
      }
    } else {
      current = this._mocks.find((mock) => mock.id === id);
      if (!current) {
        current = this._mocks[0];
        tracer.error(`Mock "${id}" was not found`);
        if (current) {
          this._addAlert(
            "current:settings",
            `Mock "${id}" was not found. Using the first one found`
          );
          tracer.info(`Using first found mock: "${current.id}"`);
        }
      }
    }
    if (!current) {
      tracer.error(`No mocks found`);
      this._addAlert("current:amount", "No mocks found");
    } else {
      tracer.info(`Current mock: "${current.id}"`);
      this._removeAlerts("current:amount");
    }

    this._currentMock = current;
    this._currentId = current && current.id;
    this._stopUsingVariants();
    this._reloadRouter();
  }

  _stopUsingVariants() {
    this._customVariants = [];
    this._customVariantsMock = null;
  }

  _createCustomMock() {
    const currentMockId = this._currentId;
    this._customVariantsMock = new Mock({
      id: `custom-variants:from:${currentMockId}`,
      routes: getMockRoutes(
        {
          from: currentMockId,
          routes: this._customVariants,
        },
        this._mocksDefinitions,
        this._routes
      ),
      getDelay: this._getDelay,
    });
  }

  restoreRouteVariants() {
    this._stopUsingVariants();
    this._reloadRouter();
  }

  useRouteVariant(variantId) {
    // TODO, validate variantId
    let inserted = false;
    this._customVariants.forEach((customVariantId, index) => {
      // TODO, use better method, store base id and variant id in an object to avoid conflicts with possible routes ids containing :
      if (!inserted && customVariantId.split(":")[0] === variantId.split(":")[0]) {
        this._customVariants.splice(index, 1, variantId);
        inserted = true;
      }
    });
    if (!inserted) {
      this._customVariants.push(variantId);
    }
    this._createCustomMock();
    this._reloadRouter();
  }

  get customRouteVariants() {
    return [...this._customVariants];
  }

  get current() {
    return this._currentId;
  }

  get ids() {
    return this._mocks.map((mock) => mock.id);
  }

  get plainMocks() {
    return [...this._plainMocks];
  }

  get plainRoutes() {
    return [...this._plainRoutes];
  }

  get plainRoutesVariants() {
    return [...this._plainRoutesVariants];
  }
}

module.exports = Mocks;