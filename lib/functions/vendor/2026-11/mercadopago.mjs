// mercadopago@3.6.1 — catálogo 2026-11 de las Edge Functions de OpenLen (npm run functions:vendor).
import { createRequire as __olCreateRequire } from "node:module";
const require = __olCreateRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/mercadoPagoConfig.js
var require_mercadoPagoConfig = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/mercadoPagoConfig.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MercadoPagoConfig = void 0;
    var MercadoPagoConfig2 = class {
      /**
       * Creates a new SDK configuration.
       *
       * @param config - Access token and optional global request settings.
       */
      constructor(config) {
        this.accessToken = config.accessToken;
        this.options = config.options;
      }
    };
    exports.MercadoPagoConfig = MercadoPagoConfig2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/utils/config/index.js
var require_config = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/utils/config/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AppConfig = void 0;
    var AppConfig = class {
      /** Returns the running Node.js version (e.g. `v18.17.0`). */
      static getNodeVersion() {
        return process.version;
      }
      /** Returns the CPU architecture (e.g. `x64`, `arm64`). */
      static getNodeArchitecture() {
        return process.arch;
      }
      /** Returns the operating system platform (e.g. `darwin`, `linux`). */
      static getNodePlatform() {
        return process.platform;
      }
      /**
       * Builds the `X-Tracking-Id` header value.
       *
       * Encodes the Node.js major version, full version, and SDK version
       * so the API team can correlate requests with specific environments.
       */
      static getTrackingId() {
        return "platform:" + this.getNodeVersion().substring(0, this.getNodeVersion().indexOf(".")) + "|" + this.getNodeVersion() + ",type:SDK" + this.SDK_VERSION + ",so;";
      }
      /**
       * Builds the `User-Agent` header value.
       *
       * Follows the pattern:
       * `MercadoPago Node.js SDK v{SDK_VERSION} (node {version}-{arch}-{platform})`
       */
      static getUserAgent() {
        return "MercadoPago Node.js SDK v" + this.SDK_VERSION + " (node " + this.getNodeVersion() + "-" + this.getNodeArchitecture() + "-" + this.getNodePlatform() + ")";
      }
    };
    exports.AppConfig = AppConfig;
    AppConfig.DEFAULT_TIMEOUT = 6e4;
    AppConfig.DEFAULT_RETRIES = 3;
    AppConfig.BASE_DELAY_MS = 1e3;
    AppConfig.DEFAULT_MAX_DELAY_MS = 3e4;
    AppConfig.DEFAULT_RETRY_ON = [429, 500, 502, 503, 504];
    AppConfig.BASE_URL = "https://api.mercadopago.com";
    AppConfig.PRODUCT_ID = "bc32b6ntrpp001u8nhkg";
    AppConfig.SDK_VERSION = "3.6.1";
    AppConfig.Headers = {
      AUTHORIZATION: "Authorization",
      CONTENT_TYPE: "Content-Type",
      USER_AGENT: "User-Agent",
      /** Ensures write operations are executed at most once. */
      IDEMPOTENCY_KEY: "X-Idempotency-Key",
      /** Internal MercadoPago product identifier for telemetry. */
      PRODUCT_ID: "X-Product-Id",
      /** SDK + Node.js version string for server-side analytics. */
      TRACKING_ID: "X-Tracking-Id",
      /** Corporation identifier for multi-account setups. */
      CORPORATION_ID: "X-Corporation-Id",
      /** Certified integrator identifier. */
      INTEGRATOR_ID: "X-Integrator-Id",
      /** Platform identifier assigned by MercadoPago. */
      PLATFORM_ID: "X-Platform-Id",
      /** MELI session identifier for session-level tracking. */
      MELI_SESSION_ID: "X-Meli-Session-Id",
      /** Comma-separated response nodes to expand. */
      EXPAND_RESPONDE_NODES: "X-Expand-Responde-Nodes",
      /** Card validation mode header. */
      CARD_VALIDATION: "X-Card-Validation",
      /** Signals the API to treat the request as a test transaction. */
      TEST_TOKEN: "X-Test-Token"
    };
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/utils/errors/index.js
var require_errors = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/utils/errors/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MPConnectionError = exports.MPServerError = exports.MPRateLimitError = exports.MPDependencyError = exports.MPResourceLockedError = exports.MPValidationError = exports.MPIdempotencyError = exports.MPNotFoundError = exports.MPForbiddenError = exports.MPPaymentError = exports.MPAuthenticationError = exports.MPBadRequestError = exports.MercadoPagoError = void 0;
    exports.buildError = buildError2;
    var MercadoPagoError2 = class extends Error {
      constructor(body) {
        var _a, _b, _c;
        const msg = body.message || body.error || "MercadoPago API error";
        super(msg);
        this.name = this.constructor.name;
        this.status = (_a = body.status) !== null && _a !== void 0 ? _a : 0;
        this.error = (_b = body.error) !== null && _b !== void 0 ? _b : "";
        this.causes = (_c = body.cause) !== null && _c !== void 0 ? _c : [];
        Object.setPrototypeOf(this, new.target.prototype);
      }
    };
    exports.MercadoPagoError = MercadoPagoError2;
    var MPBadRequestError2 = class extends MercadoPagoError2 {
    };
    exports.MPBadRequestError = MPBadRequestError2;
    var MPAuthenticationError2 = class extends MercadoPagoError2 {
    };
    exports.MPAuthenticationError = MPAuthenticationError2;
    var MPPaymentError2 = class extends MercadoPagoError2 {
    };
    exports.MPPaymentError = MPPaymentError2;
    var MPForbiddenError2 = class extends MercadoPagoError2 {
    };
    exports.MPForbiddenError = MPForbiddenError2;
    var MPNotFoundError2 = class extends MercadoPagoError2 {
    };
    exports.MPNotFoundError = MPNotFoundError2;
    var MPIdempotencyError2 = class extends MercadoPagoError2 {
    };
    exports.MPIdempotencyError = MPIdempotencyError2;
    var MPValidationError2 = class extends MercadoPagoError2 {
    };
    exports.MPValidationError = MPValidationError2;
    var MPResourceLockedError2 = class extends MercadoPagoError2 {
    };
    exports.MPResourceLockedError = MPResourceLockedError2;
    var MPDependencyError2 = class extends MercadoPagoError2 {
    };
    exports.MPDependencyError = MPDependencyError2;
    var MPRateLimitError2 = class extends MercadoPagoError2 {
      constructor(body, retryAfter = null) {
        super(body);
        this.retryAfter = retryAfter;
      }
    };
    exports.MPRateLimitError = MPRateLimitError2;
    var MPServerError2 = class extends MercadoPagoError2 {
    };
    exports.MPServerError = MPServerError2;
    var MPConnectionError2 = class extends MercadoPagoError2 {
      constructor(cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        super({ message: msg, error: "connection_error" });
        this.__cause__ = cause;
      }
    };
    exports.MPConnectionError = MPConnectionError2;
    var STATUS_MAP = {
      400: MPBadRequestError2,
      401: MPAuthenticationError2,
      402: MPPaymentError2,
      403: MPForbiddenError2,
      404: MPNotFoundError2,
      409: MPIdempotencyError2,
      422: MPValidationError2,
      423: MPResourceLockedError2,
      424: MPDependencyError2
    };
    function buildError2(status, body, retryAfter = null) {
      if (status === 429)
        return new MPRateLimitError2(Object.assign(Object.assign({}, body), { status }), retryAfter);
      const Cls = STATUS_MAP[status];
      if (Cls)
        return new Cls(Object.assign(Object.assign({}, body), { status }));
      if (status >= 500)
        return new MPServerError2(Object.assign(Object.assign({}, body), { status }));
      return new MercadoPagoError2(Object.assign(Object.assign({}, body), { status }));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/utils/restClient/index.js
var require_restClient = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/utils/restClient/index.js"(exports) {
    "use strict";
    var __rest = exports && exports.__rest || function(s, e) {
      var t = {};
      for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
      if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
          if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
            t[p[i]] = s[p[i]];
        }
      return t;
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.RestClient = void 0;
    var crypto_1 = __require("crypto");
    var config_1 = require_config();
    var errors_1 = require_errors();
    var crypto_2 = __require("crypto");
    var NO_CONTENT = 204;
    function headersToRecord(headers) {
      const out = {};
      headers.forEach((value, key) => {
        if (!out[key])
          out[key] = [];
        out[key].push(value);
      });
      return out;
    }
    var RestClient = class _RestClient {
      /** Generates a UUID v4 idempotency key for write operations. */
      static generateIdempotencyKey() {
        return (0, crypto_2.randomUUID)();
      }
      /**
       * Appends query-string parameters to a URL.
       *
       * Skips `undefined` values so callers don't need to pre-filter.
       * Handles URLs that already contain a `?` by appending with `&`.
       *
       * @param url - Base URL (may already include a query string).
       * @param queryParams - Key-value pairs to append.
       * @returns The URL with the encoded query string.
       */
      static appendQueryParamsToUrl(url, queryParams) {
        if (!queryParams)
          return url;
        const searchParams = new URLSearchParams();
        for (const key in queryParams) {
          if (Object.prototype.hasOwnProperty.call(queryParams, key) && typeof queryParams[key] !== "undefined") {
            searchParams.append(key, queryParams[key].toString());
          }
        }
        return url.includes("?") ? `${url}&${searchParams.toString()}` : `${url}?${searchParams.toString()}`;
      }
      static computeDelay(attempt, initialDelay, maxDelay, useJitter) {
        const exponential = Math.min(initialDelay * Math.pow(2, attempt), maxDelay);
        if (!useJitter || exponential <= 0)
          return exponential;
        return (0, crypto_1.randomInt)(0, exponential + 1);
      }
      static parseRetryAfterMs(response) {
        const header = response.headers.get("Retry-After");
        if (!header)
          return null;
        const seconds = parseInt(header, 10);
        return isNaN(seconds) ? null : seconds * 1e3;
      }
      static async retryWithExponentialBackoff(fn, retries, retryOn, initialDelay, maxDelay, useJitter, onRetry) {
        let lastError = new Error("Retry loop exited without result");
        for (let attempt = 0; attempt <= retries; attempt++) {
          try {
            const response = await fn();
            if (response.ok)
              return response;
            if (response.status === 204)
              return response;
            if (attempt < retries && retryOn.includes(response.status)) {
              const retryAfterMs = response.status === 429 ? _RestClient.parseRetryAfterMs(response) : null;
              const delay = retryAfterMs !== null ? Math.min(retryAfterMs, maxDelay) : _RestClient.computeDelay(attempt, initialDelay, maxDelay, useJitter);
              const errorBody = await response.json().catch(() => ({}));
              const err = (0, errors_1.buildError)(response.status, errorBody);
              lastError = err;
              onRetry === null || onRetry === void 0 ? void 0 : onRetry(attempt + 1, err);
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
            return response;
          } catch (networkError) {
            if (attempt >= retries) {
              throw new errors_1.MPConnectionError(networkError);
            }
            const err = new errors_1.MPConnectionError(networkError);
            lastError = err;
            onRetry === null || onRetry === void 0 ? void 0 : onRetry(attempt + 1, err);
            const delay = _RestClient.computeDelay(attempt, initialDelay, maxDelay, useJitter);
            await new Promise((resolve) => setTimeout(resolve, delay));
          }
        }
        throw lastError;
      }
      /**
       * Performs an HTTP request against the MercadoPago API.
       *
       * This is the single exit point for all network I/O in the SDK.
       * It merges SDK defaults with caller-provided overrides, injects
       * required headers, and normalises the JSON response.
       *
       * - **204 No Content** → returns `{ api_response }` with no body.
       * - **2xx with body** → returns the parsed JSON with `api_response` appended.
       * - **Non-2xx** → throws a typed {@link MercadoPagoError} subtype.
       *
       * @typeParam T - Expected shape of the parsed JSON response.
       * @param endpoint - API path relative to the base URL (e.g. `/v1/payments`).
       * @param config - Merged request settings (headers, body, method, options, etc.).
       * @returns Parsed API response with an `api_response` envelope.
       */
      static async fetch(endpoint, config) {
        const _a = config || {}, { timeout = config_1.AppConfig.DEFAULT_TIMEOUT, idempotencyKey = _RestClient.generateIdempotencyKey(), queryParams, method = "GET", retries = config_1.AppConfig.DEFAULT_RETRIES, maxRetries, retryOn = config_1.AppConfig.DEFAULT_RETRY_ON, initialDelay = config_1.AppConfig.BASE_DELAY_MS, maxDelay = config_1.AppConfig.DEFAULT_MAX_DELAY_MS, jitter = false, onRetry, corporationId, integratorId, platformId, meliSessionId, expandResponseNodes, cardValidation, testToken } = _a, customConfig = __rest(_a, ["timeout", "idempotencyKey", "queryParams", "method", "retries", "maxRetries", "retryOn", "initialDelay", "maxDelay", "jitter", "onRetry", "corporationId", "integratorId", "platformId", "meliSessionId", "expandResponseNodes", "cardValidation", "testToken"]);
        const effectiveRetries = maxRetries !== void 0 ? maxRetries : retries;
        const url = _RestClient.appendQueryParamsToUrl(`${config_1.AppConfig.BASE_URL}${endpoint}`, queryParams);
        customConfig.headers = Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign(Object.assign({}, customConfig.headers), { [config_1.AppConfig.Headers.CONTENT_TYPE]: "application/json", [config_1.AppConfig.Headers.PRODUCT_ID]: config_1.AppConfig.PRODUCT_ID, [config_1.AppConfig.Headers.TRACKING_ID]: config_1.AppConfig.getTrackingId(), [config_1.AppConfig.Headers.USER_AGENT]: config_1.AppConfig.getUserAgent() }), corporationId ? { [config_1.AppConfig.Headers.CORPORATION_ID]: corporationId } : {}), integratorId ? { [config_1.AppConfig.Headers.INTEGRATOR_ID]: integratorId } : {}), platformId ? { [config_1.AppConfig.Headers.PLATFORM_ID]: platformId } : {}), meliSessionId ? { [config_1.AppConfig.Headers.MELI_SESSION_ID]: meliSessionId } : {}), expandResponseNodes ? { [config_1.AppConfig.Headers.EXPAND_RESPONDE_NODES]: expandResponseNodes } : {}), cardValidation ? { [config_1.AppConfig.Headers.CARD_VALIDATION]: cardValidation } : {}), testToken ? { [config_1.AppConfig.Headers.TEST_TOKEN]: testToken.toString() } : {});
        if (method && method !== "GET") {
          customConfig.headers = Object.assign(Object.assign({}, customConfig.headers), { [config_1.AppConfig.Headers.IDEMPOTENCY_KEY]: idempotencyKey });
        }
        const fetchFn = async () => {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), timeout);
          try {
            return await fetch(url, Object.assign(Object.assign({}, customConfig), { method, signal: controller.signal }));
          } finally {
            clearTimeout(timeoutId);
          }
        };
        const response = await _RestClient.retryWithExponentialBackoff(fetchFn, effectiveRetries, retryOn, initialDelay, maxDelay, jitter, onRetry);
        if (response.status === NO_CONTENT) {
          return {
            api_response: {
              status: response.status,
              headers: headersToRecord(response.headers)
            }
          };
        }
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const retryAfter = response.status === 429 ? _RestClient.parseRetryAfterMs(response) : null;
          const seconds = retryAfter !== null ? retryAfter / 1e3 : null;
          throw (0, errors_1.buildError)(response.status, body, seconds);
        }
        const api_response = {
          status: response.status,
          headers: headersToRecord(response.headers)
        };
        body.api_response = api_response;
        return body;
      }
    };
    exports.RestClient = RestClient;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/cardToken/create/index.js
var require_create = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/cardToken/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var restClient_1 = require_restClient();
    function create({ body, config }) {
      return restClient_1.RestClient.fetch("/v1/card_tokens", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body), method: "POST" }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/utils/path.js
var require_path = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/utils/path.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.encodePathParam = encodePathParam;
    function encodePathParam(value) {
      return encodeURIComponent(value.toString());
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/cardToken/get/index.js
var require_get = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/cardToken/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function get({ id, config }) {
      return restClient_1.RestClient.fetch(`/v1/card_tokens/${(0, path_1.encodePathParam)(id)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/cardToken/index.js
var require_cardToken = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/cardToken/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CardToken = void 0;
    var create_1 = __importDefault(require_create());
    var get_1 = __importDefault(require_get());
    var CardToken2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Create a card token from card details or a saved card ID.
       *
       * The returned token ID should be used in the `token` field when
       * creating a payment.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/examples/cardtoken/create.ts Usage Example }.
       */
      create({ body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ body, config: this.config });
      }
      /**
       * Retrieve a single card token by its unique identifier.
       *
       * Calls `GET /v1/card_tokens/:id` and returns the full card token resource.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/examples/cardtoken/get.ts Usage Example }.
       */
      get({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ id, config: this.config });
      }
    };
    exports.CardToken = CardToken2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customerCard/get/index.js
var require_get2 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customerCard/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function get({ customerId, cardId, config }) {
      return restClient_1.RestClient.fetch(`/v1/customers/${(0, path_1.encodePathParam)(customerId)}/cards/${(0, path_1.encodePathParam)(cardId)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customerCard/create/index.js
var require_create2 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customerCard/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function create({ customerId, body, config }) {
      return restClient_1.RestClient.fetch(`/v1/customers/${(0, path_1.encodePathParam)(customerId)}/cards`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body), method: "POST" }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customerCard/remove/index.js
var require_remove = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customerCard/remove/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = remove;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function remove({ customerId, cardId, config }) {
      return restClient_1.RestClient.fetch(`/v1/customers/${(0, path_1.encodePathParam)(customerId)}/cards/${(0, path_1.encodePathParam)(cardId)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, method: "DELETE" }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customerCard/update/index.js
var require_update = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customerCard/update/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = update;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function update({ customerId, cardId, body, config }) {
      return restClient_1.RestClient.fetch(`/v1/customers/${(0, path_1.encodePathParam)(customerId)}/cards/${(0, path_1.encodePathParam)(cardId)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body), method: "PUT" }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customerCard/list/index.js
var require_list = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customerCard/list/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = list;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function list({ customerId, config }) {
      return restClient_1.RestClient.fetch(`/v1/customers/${(0, path_1.encodePathParam)(customerId)}/cards`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customerCard/index.js
var require_customerCard = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customerCard/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CustomerCard = void 0;
    var get_1 = __importDefault(require_get2());
    var create_1 = __importDefault(require_create2());
    var remove_1 = __importDefault(require_remove());
    var update_1 = __importDefault(require_update());
    var list_1 = __importDefault(require_list());
    var CustomerCard2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Save a new payment card for a customer using a card token.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/create.ts Usage Example  }.
       */
      create({ customerId, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ customerId, body, config: this.config });
      }
      /**
       * Retrieve a specific saved card for a customer.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/get.ts Usage Example  }.
      */
      get({ customerId, cardId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ customerId, cardId, config: this.config });
      }
      /**
       * Remove a saved card from a customer's wallet.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/remove.ts Usage Example  }.
       */
      remove({ customerId, cardId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, remove_1.default)({ customerId, cardId, config: this.config });
      }
      /**
       * Update the details of an existing saved card (e.g. expiration date or cardholder info).
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/update.ts Usage Example  }.
       */
      update({ customerId, cardId, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, update_1.default)({ customerId, cardId, body, config: this.config });
      }
      /**
       * List all saved payment cards for a customer.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/list.ts Usage Example  }.
       */
      list({ customerId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, list_1.default)({ customerId, config: this.config });
      }
    };
    exports.CustomerCard = CustomerCard2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customer/get/index.js
var require_get3 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customer/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function get({ customerId, config }) {
      return restClient_1.RestClient.fetch(`/v1/customers/${(0, path_1.encodePathParam)(customerId)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customer/create/index.js
var require_create3 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customer/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var restClient_1 = require_restClient();
    function create({ body, config }) {
      return restClient_1.RestClient.fetch("/v1/customers", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body), method: "POST" }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customer/remove/index.js
var require_remove2 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customer/remove/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = remove;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function remove({ customerId, config }) {
      return restClient_1.RestClient.fetch(`/v1/customers/${(0, path_1.encodePathParam)(customerId)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, method: "DELETE" }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customer/update/index.js
var require_update2 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customer/update/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = update;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function update({ customerId, body, config }) {
      return restClient_1.RestClient.fetch(`/v1/customers/${(0, path_1.encodePathParam)(customerId)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body), method: "PUT" }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customer/search/index.js
var require_search = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customer/search/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = search;
    var restClient_1 = require_restClient();
    function search({ options, config }) {
      return restClient_1.RestClient.fetch("/v1/customers/search", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, queryParams: Object.assign({}, options) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/utils/pagination/index.js
var require_pagination = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/utils/pagination/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.createAutoPagingIterable = createAutoPagingIterable;
    var DEFAULT_PAGE_SIZE = 100;
    function createAutoPagingIterable(searchFn, baseOptions, pageSize = DEFAULT_PAGE_SIZE) {
      return {
        [Symbol.asyncIterator]() {
          var _a;
          let offset = (_a = baseOptions === null || baseOptions === void 0 ? void 0 : baseOptions.offset) !== null && _a !== void 0 ? _a : 0;
          let page = 1;
          let buffer = [];
          let bufferIndex = 0;
          let done = false;
          let total = null;
          const fetchNextPage = async () => {
            var _a2, _b, _c, _d, _e;
            if (done)
              return;
            const options = Object.assign(Object.assign({}, baseOptions), { limit: pageSize, offset });
            const result = await searchFn(options);
            if (result.results !== void 0) {
              const items = (_a2 = result.results) !== null && _a2 !== void 0 ? _a2 : [];
              buffer = items;
              bufferIndex = 0;
              if (total === null && result.paging) {
                total = result.paging.total;
              }
              offset += items.length;
              if (items.length === 0 || total !== null && offset >= total) {
                done = true;
              }
              return;
            }
            if (result.elements !== void 0) {
              const items = (_b = result.elements) !== null && _b !== void 0 ? _b : [];
              buffer = items;
              bufferIndex = 0;
              if (total === null)
                total = (_c = result.total) !== null && _c !== void 0 ? _c : 0;
              page++;
              offset = (page - 1) * pageSize;
              if (items.length === 0 || offset >= (total !== null && total !== void 0 ? total : 0)) {
                done = true;
              }
              return;
            }
            if (result.data !== void 0) {
              const items = (_d = result.data) !== null && _d !== void 0 ? _d : [];
              buffer = items;
              bufferIndex = 0;
              if (total === null && result.paging) {
                total = parseInt(String((_e = result.paging.total) !== null && _e !== void 0 ? _e : "0"), 10);
              }
              offset += items.length;
              if (items.length === 0 || total !== null && offset >= total) {
                done = true;
              }
              return;
            }
            done = true;
          };
          return {
            async next() {
              if (bufferIndex < buffer.length) {
                return { value: buffer[bufferIndex++], done: false };
              }
              if (done) {
                return { value: void 0, done: true };
              }
              await fetchNextPage();
              if (bufferIndex < buffer.length) {
                return { value: buffer[bufferIndex++], done: false };
              }
              return { value: void 0, done: true };
            }
          };
        }
      };
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customer/index.js
var require_customer = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/customer/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Customer = void 0;
    var get_1 = __importDefault(require_get3());
    var create_1 = __importDefault(require_create3());
    var remove_1 = __importDefault(require_remove2());
    var update_1 = __importDefault(require_update2());
    var search_1 = __importDefault(require_search());
    var customerCard_1 = require_customerCard();
    var pagination_1 = require_pagination();
    var Customer2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
        this.customerCard = new customerCard_1.CustomerCard(mercadoPagoConfig);
      }
      /**
       * Create a new customer in MercadoPago.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/create.ts Usage Example  }.
       */
      create({ body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ body, config: this.config });
      }
      /**
       * Retrieve a single customer by its unique identifier.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/get.ts Usage Example  }.
       */
      get({ customerId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ customerId, config: this.config });
      }
      /**
       * Remove an existing customer by its unique identifier.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/remove.ts Usage Example  }.
       */
      remove({ customerId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, remove_1.default)({ customerId, config: this.config });
      }
      /**
       * Update an existing customer's information.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/update.ts Usage Example  }.
       */
      update({ customerId, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, update_1.default)({ customerId, body, config: this.config });
      }
      /**
       * Search for customers using optional filters and pagination.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/search.ts Usage Example  }.
       */
      search(CustomerSearchOptions = {}) {
        const { options, requestOptions } = CustomerSearchOptions;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, search_1.default)({ options, config: this.config });
      }
      /**
       * Save a new payment card for a customer using a card token.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/createCard.ts Usage Example  }.
       */
      createCard({ customerId, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return this.customerCard.create({ customerId, body });
      }
      /**
       * Retrieve a specific saved card for a customer.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/getCard.ts Usage Example  }.
       */
      getCard({ customerId, cardId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return this.customerCard.get({ customerId, cardId });
      }
      /**
       * Remove a saved card from a customer's account.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/removeCard.ts Usage Example  }.
       */
      removeCard({ customerId, cardId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return this.customerCard.remove({ customerId, cardId });
      }
      /**
       * List all saved payment cards for a customer.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/customer/listCards.ts Usage Example  }.
       */
      listCards({ customerId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return this.customerCard.list({ customerId });
      }
      /** Lazily iterates over every customer matching the search criteria. */
      searchAll(searchData = {}) {
        const { options, requestOptions } = searchData;
        return (0, pagination_1.createAutoPagingIterable)((opts) => {
          this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
          return (0, search_1.default)({ options: Object.assign(Object.assign({}, options), opts), config: this.config });
        }, options);
      }
    };
    exports.Customer = Customer2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/create/index.js
var require_create4 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var restClient_1 = require_restClient();
    function create({ body, config }) {
      return restClient_1.RestClient.fetch("/v1/advanced_payments", Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/get/index.js
var require_get4 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function get({ id, config }) {
      return restClient_1.RestClient.fetch(`/v1/advanced_payments/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "GET", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/search/index.js
var require_search2 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/search/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = search;
    var restClient_1 = require_restClient();
    function search({ options, config }) {
      return restClient_1.RestClient.fetch("/v1/advanced_payments/search", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, queryParams: Object.assign({}, options) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/update/index.js
var require_update3 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/update/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = update;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function update({ id, body, config }) {
      return restClient_1.RestClient.fetch(`/v1/advanced_payments/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "PUT", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/cancel/index.js
var require_cancel = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/cancel/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = cancel;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function cancel({ id, config }) {
      return restClient_1.RestClient.fetch(`/v1/advanced_payments/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "PUT", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify({ status: "cancelled" }) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/capture/index.js
var require_capture = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/capture/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = capture;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function capture({ id, config }) {
      return restClient_1.RestClient.fetch(`/v1/advanced_payments/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "PUT", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify({ capture: true }) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/updateReleaseDate/index.js
var require_updateReleaseDate = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/updateReleaseDate/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = updateReleaseDate;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function updateReleaseDate({ id, releaseDate, config }) {
      return restClient_1.RestClient.fetch(`/v1/advanced_payments/${(0, path_1.encodePathParam)(id)}/disburses`, Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify({ money_release_date: releaseDate }) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/index.js
var require_advancedPayment = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/advancedPayment/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AdvancedPayment = void 0;
    var create_1 = __importDefault(require_create4());
    var get_1 = __importDefault(require_get4());
    var search_1 = __importDefault(require_search2());
    var update_1 = __importDefault(require_update3());
    var cancel_1 = __importDefault(require_cancel());
    var capture_1 = __importDefault(require_capture());
    var updateReleaseDate_1 = __importDefault(require_updateReleaseDate());
    var AdvancedPayment2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Create a new advanced (split) payment distributed among multiple sellers.
       */
      create({ body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ body, config: this.config });
      }
      /**
       * Retrieve an advanced payment by its ID.
       */
      get({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ id, config: this.config });
      }
      /**
       * Search advanced payments with optional filters and pagination.
       */
      search(advancedPaymentSearchOptions = {}) {
        const { options, requestOptions } = advancedPaymentSearchOptions;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, search_1.default)({ options, config: this.config });
      }
      /**
       * Update an existing advanced payment with arbitrary fields.
       */
      update({ id, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, update_1.default)({ id, body, config: this.config });
      }
      /**
       * Cancel a pending advanced payment by setting its status to `cancelled`.
       */
      cancel({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, cancel_1.default)({ id, config: this.config });
      }
      /**
       * Capture a previously authorised advanced payment.
       */
      capture({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, capture_1.default)({ id, config: this.config });
      }
      /**
       * Change the money release date for all disbursements of an advanced payment.
       */
      updateReleaseDate({ id, releaseDate, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, updateReleaseDate_1.default)({ id, releaseDate, config: this.config });
      }
    };
    exports.AdvancedPayment = AdvancedPayment2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/chargeback/get/index.js
var require_get5 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/chargeback/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function get({ id, config }) {
      return restClient_1.RestClient.fetch(`/v1/chargebacks/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "GET", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/chargeback/search/index.js
var require_search3 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/chargeback/search/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = search;
    var restClient_1 = require_restClient();
    function search({ options, config }) {
      return restClient_1.RestClient.fetch("/v1/chargebacks/search", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, queryParams: Object.assign({}, options) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/chargeback/index.js
var require_chargeback = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/chargeback/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Chargeback = void 0;
    var get_1 = __importDefault(require_get5());
    var search_1 = __importDefault(require_search3());
    var Chargeback2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Retrieve a single chargeback by its ID.
       */
      get({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ id, config: this.config });
      }
      /**
       * Search chargebacks with optional filters.
       */
      search(chargebackSearchOptions = {}) {
        const { options, requestOptions } = chargebackSearchOptions;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, search_1.default)({ options, config: this.config });
      }
    };
    exports.Chargeback = Chargeback2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/disbursementRefund/listAll/index.js
var require_listAll = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/disbursementRefund/listAll/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = listAll;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function listAll({ advancedPaymentId, config }) {
      return restClient_1.RestClient.fetch(`/v1/advanced_payments/${(0, path_1.encodePathParam)(advancedPaymentId)}/refunds`, Object.assign({ method: "GET", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/disbursementRefund/createAll/index.js
var require_createAll = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/disbursementRefund/createAll/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = createAll;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function createAll({ advancedPaymentId, body, config }) {
      return restClient_1.RestClient.fetch(`/v1/advanced_payments/${(0, path_1.encodePathParam)(advancedPaymentId)}/refunds`, Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/disbursementRefund/create/index.js
var require_create5 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/disbursementRefund/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function create({ advancedPaymentId, disbursementId, body, config }) {
      return restClient_1.RestClient.fetch(`/v1/advanced_payments/${(0, path_1.encodePathParam)(advancedPaymentId)}/disbursements/${(0, path_1.encodePathParam)(disbursementId)}/refunds`, Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/disbursementRefund/index.js
var require_disbursementRefund = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/disbursementRefund/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.DisbursementRefund = void 0;
    var listAll_1 = __importDefault(require_listAll());
    var createAll_1 = __importDefault(require_createAll());
    var create_1 = __importDefault(require_create5());
    var DisbursementRefund2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * List all refunds for an advanced payment.
       */
      listAll({ advancedPaymentId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, listAll_1.default)({ advancedPaymentId, config: this.config });
      }
      /**
       * Refund all disbursements of an advanced payment at once.
       */
      createAll({ advancedPaymentId, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, createAll_1.default)({ advancedPaymentId, body, config: this.config });
      }
      /**
       * Refund a specific disbursement by amount.
       */
      create({ advancedPaymentId, disbursementId, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ advancedPaymentId, disbursementId, body, config: this.config });
      }
    };
    exports.DisbursementRefund = DisbursementRefund2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/invoice/get/index.js
var require_get6 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/invoice/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function get({ id, config }) {
      return restClient_1.RestClient.fetch(`/authorized_payments/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "GET", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/invoice/search/index.js
var require_search4 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/invoice/search/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = search;
    var restClient_1 = require_restClient();
    function search({ options, config }) {
      return restClient_1.RestClient.fetch("/authorized_payments/search", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, queryParams: Object.assign({}, options) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/invoice/index.js
var require_invoice = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/invoice/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Invoice = void 0;
    var get_1 = __importDefault(require_get6());
    var search_1 = __importDefault(require_search4());
    var Invoice2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Retrieve a single subscription invoice by its ID.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/invoice/get.ts Usage Example }.
       */
      get({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ id, config: this.config });
      }
      /**
       * Search subscription invoices with optional filters.
       *
       * Filters include preapproval ID, payer ID, payment ID, and pagination.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/invoice/search.ts Usage Example }.
       */
      search(ivoicesSearchOptions = {}) {
        const { options, requestOptions } = ivoicesSearchOptions;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, search_1.default)({ options, config: this.config });
      }
    };
    exports.Invoice = Invoice2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/identificationType/list/index.js
var require_list2 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/identificationType/list/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = list;
    var restClient_1 = require_restClient();
    function list({ config }) {
      return restClient_1.RestClient.fetch("/v1/identification_types", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/identificationType/index.js
var require_identificationType = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/identificationType/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.IdentificationType = void 0;
    var list_1 = __importDefault(require_list2());
    var IdentificationType2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * List all accepted identification document types for the account's country.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/examples/identificationtype/list.ts Usage Example }.
       */
      list(identificationTypeListOptions = {}) {
        const { requestOptions } = identificationTypeListOptions;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, list_1.default)({ config: this.config });
      }
    };
    exports.IdentificationType = IdentificationType2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentRefund/get/index.js
var require_get7 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentRefund/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function get({ payment_id, refund_id, config }) {
      return restClient_1.RestClient.fetch(`/v1/payments/${(0, path_1.encodePathParam)(payment_id)}/refunds/${(0, path_1.encodePathParam)(refund_id)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentRefund/create/index.js
var require_create6 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentRefund/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function create({ payment_id, body, config }) {
      return restClient_1.RestClient.fetch(`/v1/payments/${(0, path_1.encodePathParam)(payment_id)}/refunds`, Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentRefund/list/index.js
var require_list3 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentRefund/list/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = list;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function list({ payment_id, config }) {
      return restClient_1.RestClient.fetch(`/v1/payments/${(0, path_1.encodePathParam)(payment_id)}/refunds/`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentRefund/total/index.js
var require_total = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentRefund/total/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = total;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function total({ payment_id, config }) {
      return restClient_1.RestClient.fetch(`/v1/payments/${(0, path_1.encodePathParam)(payment_id)}/refunds`, Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify({}) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentRefund/index.js
var require_paymentRefund = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentRefund/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PaymentRefund = void 0;
    var get_1 = __importDefault(require_get7());
    var create_1 = __importDefault(require_create6());
    var list_1 = __importDefault(require_list3());
    var total_1 = __importDefault(require_total());
    var PaymentRefund2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Retrieve a specific refund by payment ID and refund ID.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/paymentRefund/get.ts Usage Example }.
       */
      get({ payment_id, refund_id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ payment_id, refund_id, config: this.config });
      }
      /**
       * Create a partial refund on a payment.
       *
       * To refund a specific amount, include the `amount` field in the body.
       * For a full refund, use the {@link total} method instead.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/paymentRefund/create.ts Usage Example }.
       */
      create({ payment_id, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ payment_id, body, config: this.config });
      }
      /**
       * Create a total (full-amount) refund on a payment.
       *
       * Refunds the entire payment amount. No request body is required.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/paymentRefund/create.ts Usage Example }.
       */
      total({ payment_id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, total_1.default)({ payment_id, config: this.config });
      }
      /**
       * List all refunds associated with a payment.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/paymentRefund/list.ts Usage Example }.
       */
      list({ payment_id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, list_1.default)({ payment_id, config: this.config });
      }
    };
    exports.PaymentRefund = PaymentRefund2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentMethod/get/index.js
var require_get8 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentMethod/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var restClient_1 = require_restClient();
    function get({ config }) {
      return restClient_1.RestClient.fetch("/v1/payment_methods", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentMethod/index.js
var require_paymentMethod = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/paymentMethod/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PaymentMethod = void 0;
    var get_1 = __importDefault(require_get8());
    var PaymentMethod2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Retrieve all payment methods available for the authenticated account.
       *
       * Returns an array of payment methods with their settings, amount
       * constraints, and processing modes.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/examples/paymentmethod/get.ts Usage Example }.
       */
      get(paymentMethodsGetOptions = {}) {
        const { requestOptions } = paymentMethodsGetOptions;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ config: this.config });
      }
    };
    exports.PaymentMethod = PaymentMethod2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/capture/index.js
var require_capture2 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/capture/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = capture;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function capture({ id, transaction_amount, config }) {
      const captureBody = {
        capture: true,
        transaction_amount
      };
      return restClient_1.RestClient.fetch(`/v1/payments/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "PUT", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(captureBody) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/search/index.js
var require_search5 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/search/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = search;
    var restClient_1 = require_restClient();
    function search({ options, config }) {
      return restClient_1.RestClient.fetch("/v1/payments/search", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, queryParams: Object.assign({}, options) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/cancel/index.js
var require_cancel2 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/cancel/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = cancel;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function cancel({ id, config }) {
      const cancelBody = {
        status: "cancelled"
      };
      return restClient_1.RestClient.fetch(`/v1/payments/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "PUT", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(cancelBody) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/create/index.js
var require_create7 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var restClient_1 = require_restClient();
    function create({ body, config }) {
      return restClient_1.RestClient.fetch("/v1/payments", Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/get/index.js
var require_get9 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function get({ id, config }) {
      return restClient_1.RestClient.fetch(`/v1/payments/${(0, path_1.encodePathParam)(id)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/update/index.js
var require_update4 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/update/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = update;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function update({ id, body, config }) {
      return restClient_1.RestClient.fetch(`/v1/payments/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "PUT", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/index.js
var require_payment = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/payment/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Payment = void 0;
    var capture_1 = __importDefault(require_capture2());
    var search_1 = __importDefault(require_search5());
    var cancel_1 = __importDefault(require_cancel2());
    var create_1 = __importDefault(require_create7());
    var get_1 = __importDefault(require_get9());
    var update_1 = __importDefault(require_update4());
    var pagination_1 = require_pagination();
    var Payment2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Search payments that belong to the authenticated collector.
       *
       * Supports pagination, sorting, date-range filtering, and arbitrary
       * query-parameter filters forwarded to `GET /v1/payments/search`.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/payment/search.ts Usage Example}
       */
      search(paymentSearchOptions = {}) {
        const { options, requestOptions } = paymentSearchOptions;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, search_1.default)({ options, config: this.config });
      }
      /**
       * Cancel a pending or in-process payment by setting its status to `cancelled`.
       *
       * Only payments that have not yet been approved can be cancelled.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/payment/cancel.ts Usage Example}
       */
      cancel({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, cancel_1.default)({ id, config: this.config });
      }
      /**
       * Capture a previously authorized (pre-auth) payment.
       *
       * When the payment was created with `capture: false`, this method finalizes
       * the charge.  An optional `transaction_amount` allows partial captures.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/payment/capture.ts Usage Example}
       */
      capture({ id, transaction_amount, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, capture_1.default)({ id, transaction_amount, config: this.config });
      }
      /**
       * Create a new payment via `POST /v1/payments`.
       *
       * The request body must contain at least a `transaction_amount`, a `payer`,
       * and a `payment_method_id` (or a card `token`).
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/payment/create.ts Usage Example}
       */
      create({ body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ body, config: this.config });
      }
      /**
       * Retrieve a single payment by its unique identifier.
       *
       * Calls `GET /v1/payments/:id` and returns the full payment resource.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/payment/get.ts Usage Example}
       */
      get({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ id, config: this.config });
      }
      /**
       * Update an existing payment via `PUT /v1/payments/:id`.
       *
       * Accepts any subset of payment fields to modify on the existing resource.
       */
      update({ id, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, update_1.default)({ id, body, config: this.config });
      }
      /**
       * Lazily iterates over every payment matching the search criteria.
       *
       * Pages are fetched on demand as the async iterator advances.
       *
       * @example
       * ```ts
       * for await (const payment of new Payment(config).searchAll({ options: { status: 'approved' } })) {
       *   console.log(payment.id);
       * }
       * ```
       */
      searchAll(searchData = {}) {
        const { options, requestOptions } = searchData;
        return (0, pagination_1.createAutoPagingIterable)((opts) => {
          this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
          return (0, search_1.default)({ options: Object.assign(Object.assign({}, options), opts), config: this.config });
        }, options);
      }
    };
    exports.Payment = Payment2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApproval/create/index.js
var require_create8 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApproval/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var restClient_1 = require_restClient();
    function create({ body, config }) {
      return restClient_1.RestClient.fetch("/preapproval/", Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApproval/get/index.js
var require_get10 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApproval/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function get({ id, config }) {
      return restClient_1.RestClient.fetch(`/preapproval/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "GET", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApproval/search/index.js
var require_search6 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApproval/search/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = search;
    var restClient_1 = require_restClient();
    function search({ options, config }) {
      return restClient_1.RestClient.fetch("/preapproval/search", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, queryParams: Object.assign({}, options) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApproval/update/index.js
var require_update5 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApproval/update/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = update;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function update({ id, body, config }) {
      return restClient_1.RestClient.fetch(`/preapproval/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "PUT", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApproval/index.js
var require_preApproval = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApproval/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PreApproval = void 0;
    var create_1 = __importDefault(require_create8());
    var get_1 = __importDefault(require_get10());
    var search_1 = __importDefault(require_search6());
    var update_1 = __importDefault(require_update5());
    var PreApproval2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Create a new subscription for a buyer.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/preApproval/create.ts Usage Example }.
       */
      create({ body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ body, config: this.config });
      }
      /**
       * Retrieve an existing subscription by its unique identifier.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/preApproval/get.ts Usage Example }.
       */
      get({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ id, config: this.config });
      }
      /**
       * Search subscriptions using filters such as status, payer, or plan.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/preApproval/search.ts Usage Example }.
       */
      search(preApprovalSearchData = {}) {
        const { options, requestOptions } = preApprovalSearchData;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, search_1.default)({ options, config: this.config });
      }
      /**
       * Update an existing subscription (e.g. change status, amount, or card token).
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/preApproval/update.ts Usage Example }.
       */
      update({ id, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, update_1.default)({ id, body, config: this.config });
      }
    };
    exports.PreApproval = PreApproval2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApprovalPlan/get/index.js
var require_get11 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApprovalPlan/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function get({ id, config }) {
      return restClient_1.RestClient.fetch(`/preapproval_plan/${(0, path_1.encodePathParam)(id)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApprovalPlan/create/index.js
var require_create9 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApprovalPlan/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var restClient_1 = require_restClient();
    function create({ body, config }) {
      return restClient_1.RestClient.fetch("/preapproval_plan/", Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApprovalPlan/update/index.js
var require_update6 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApprovalPlan/update/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = update;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function update({ id, updatePreApprovalPlanRequest, config }) {
      return restClient_1.RestClient.fetch(`/preapproval_plan/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "PUT", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(updatePreApprovalPlanRequest) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApprovalPlan/search/index.js
var require_search7 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApprovalPlan/search/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = search;
    var restClient_1 = require_restClient();
    function search({ options, config }) {
      return restClient_1.RestClient.fetch("/preapproval_plan/search", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, queryParams: Object.assign({}, options) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApprovalPlan/index.js
var require_preApprovalPlan = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preApprovalPlan/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.PreApprovalPlan = void 0;
    var get_1 = __importDefault(require_get11());
    var create_1 = __importDefault(require_create9());
    var update_1 = __importDefault(require_update6());
    var search_1 = __importDefault(require_search7());
    var PreApprovalPlan2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Create a new subscription plan template.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/preapprovalplan/create.ts Usage Example }.
       */
      create({ body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ body, config: this.config });
      }
      /**
       * Retrieve an existing subscription plan by its unique identifier.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/preapprovalplan/get.ts Usage Example }.
       */
      get({ preApprovalPlanId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ id: preApprovalPlanId, config: this.config });
      }
      /**
       * Update an existing subscription plan (e.g. change amount, status, or allowed payment methods).
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/preapprovalplan/update.ts Usage Example }.
       */
      update({ id, updatePreApprovalPlanRequest, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, update_1.default)({ id, updatePreApprovalPlanRequest, config: this.config });
      }
      /**
       * Search subscription plans using filters such as status or free-text query.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/preapprovalplan/search.ts Usage Example }.
       */
      search(preApprovalPlanSearchData = {}) {
        const { options, requestOptions } = preApprovalPlanSearchData;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, search_1.default)({ options, config: this.config });
      }
    };
    exports.PreApprovalPlan = PreApprovalPlan2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/cancelPaymentIntent/index.js
var require_cancelPaymentIntent = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/cancelPaymentIntent/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = cancelPaymentIntent;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function cancelPaymentIntent({ device_id, payment_intent_id, config }) {
      return restClient_1.RestClient.fetch(`/point/integration-api/devices/${(0, path_1.encodePathParam)(device_id)}/payment-intents/${(0, path_1.encodePathParam)(payment_intent_id)}`, Object.assign({ method: "DELETE", headers: {
        Authorization: `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/changeDeviceOperatingMode/index.js
var require_changeDeviceOperatingMode = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/changeDeviceOperatingMode/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = changeDeviceOperatingMode;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function changeDeviceOperatingMode({ device_id, request, config }) {
      return restClient_1.RestClient.fetch(`/point/integration-api/devices/${(0, path_1.encodePathParam)(device_id)}`, Object.assign({ method: "PATCH", headers: {
        Authorization: `Bearer ${config.accessToken}`
      }, body: JSON.stringify(request) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/createPaymentIntent/index.js
var require_createPaymentIntent = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/createPaymentIntent/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = createPaymentIntent;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function createPaymentIntent({ device_id, request, config }) {
      return restClient_1.RestClient.fetch(`/point/integration-api/devices/${(0, path_1.encodePathParam)(device_id)}/payment-intents`, Object.assign({ method: "POST", headers: {
        Authorization: `Bearer ${config.accessToken}`
      }, body: JSON.stringify(request) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/getDevices/index.js
var require_getDevices = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/getDevices/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = getDevices;
    var restClient_1 = require_restClient();
    function getDevices({ options, config }) {
      return restClient_1.RestClient.fetch("/point/integration-api/devices", Object.assign({ method: "GET", headers: {
        Authorization: `Bearer ${config.accessToken}`
      }, queryParams: Object.assign({}, options) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/getPaymentIntentList/index.js
var require_getPaymentIntentList = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/getPaymentIntentList/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = getPaymentIntentList;
    var restClient_1 = require_restClient();
    function getPaymentIntentList({ options, config }) {
      return restClient_1.RestClient.fetch("/point/integration-api/payment-intents/events", Object.assign({ method: "GET", headers: {
        Authorization: `Bearer ${config.accessToken}`
      }, queryParams: Object.assign({}, options) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/getPaymentIntentStatus/index.js
var require_getPaymentIntentStatus = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/getPaymentIntentStatus/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = getPaymentIntentStatus;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function getPaymentIntentStatus({ payment_intent_id, config }) {
      return restClient_1.RestClient.fetch(`/point/integration-api/payment-intents/${(0, path_1.encodePathParam)(payment_intent_id)}/events`, Object.assign({ method: "GET", headers: {
        Authorization: `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/searchPaymentIntent/index.js
var require_searchPaymentIntent = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/searchPaymentIntent/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = searchPaymentIntent;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function searchPaymentIntent({ payment_intent_id, config }) {
      return restClient_1.RestClient.fetch(`/point/integration-api/payment-intents/${(0, path_1.encodePathParam)(payment_intent_id)}`, Object.assign({ method: "GET", headers: {
        Authorization: `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/index.js
var require_point = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/point/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Point = void 0;
    var cancelPaymentIntent_1 = __importDefault(require_cancelPaymentIntent());
    var changeDeviceOperatingMode_1 = __importDefault(require_changeDeviceOperatingMode());
    var createPaymentIntent_1 = __importDefault(require_createPaymentIntent());
    var getDevices_1 = __importDefault(require_getDevices());
    var getPaymentIntentList_1 = __importDefault(require_getPaymentIntentList());
    var getPaymentIntentStatus_1 = __importDefault(require_getPaymentIntentStatus());
    var searchPaymentIntent_1 = __importDefault(require_searchPaymentIntent());
    var Point2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Create a new payment intent on a specific Point device.
       *
       * The intent is sent to the terminal, which will prompt the buyer to
       * present a card or other payment method.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/point/createPaymentIntent.ts Usage Example }.
       */
      createPaymentIntent({ device_id, request, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, createPaymentIntent_1.default)({ device_id, request, config: this.config });
      }
      /**
       * Retrieve the details of an existing payment intent by its ID.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/point/searchPaymentIntent.ts Usage Example }.
       */
      searchPaymentIntent({ payment_intent_id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, searchPaymentIntent_1.default)({ payment_intent_id, config: this.config });
      }
      /**
       * Cancel a pending payment intent on a specific Point device.
       *
       * Only intents that have not yet been completed can be cancelled.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/point/cancelPaymentIntent.ts Usage Example }.
       */
      cancelPaymentIntent({ device_id, payment_intent_id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, cancelPaymentIntent_1.default)({ device_id, payment_intent_id, config: this.config });
      }
      /**
       * List payment intent events, optionally filtered by date range.
       *
       * Returns the lifecycle events (creation, completion, cancellation) for
       * all payment intents associated with the authenticated account.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/point/getPaymentIntentList.ts Usage Example }.
       */
      getPaymentIntentList(pointGetPaymentIntentListOptions = {}) {
        const { body, requestOptions } = pointGetPaymentIntentListOptions;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, getPaymentIntentList_1.default)({ options: body === null || body === void 0 ? void 0 : body.options, config: this.config });
      }
      /**
       * Get the latest status event for a specific payment intent.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/point/getPaymentIntentStatus.ts Usage Example }.
       */
      getPaymentIntentStatus({ payment_intent_id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, getPaymentIntentStatus_1.default)({ payment_intent_id, config: this.config });
      }
      /**
       * List Point devices registered to the authenticated account.
       *
       * Results can be filtered by store and POS identifiers.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/point/getDevices.ts Usage Example }.
       */
      getDevices({ request, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, getDevices_1.default)({ options: request === null || request === void 0 ? void 0 : request.options, config: this.config });
      }
      /**
       * Change the operating mode of a Point device (e.g. `PDV` or `STANDALONE`).
       *
       * In `PDV` mode the device receives payment intents from the integration;
       * in `STANDALONE` mode the seller operates the device manually.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/point/changeDeviceOperatingMode.ts Usage Example }.
       */
      changeDeviceOperatingMode({ device_id, request, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, changeDeviceOperatingMode_1.default)({ device_id, request, config: this.config });
      }
    };
    exports.Point = Point2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preference/get/index.js
var require_get12 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preference/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function get({ id, config }) {
      return restClient_1.RestClient.fetch(`/checkout/preferences/${(0, path_1.encodePathParam)(id)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preference/create/index.js
var require_create10 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preference/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var restClient_1 = require_restClient();
    function create({ body, config }) {
      return restClient_1.RestClient.fetch("/checkout/preferences/", Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preference/update/index.js
var require_update7 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preference/update/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = update;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function update({ id, updatePreferenceRequest, config }) {
      return restClient_1.RestClient.fetch(`/checkout/preferences/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "PUT", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(updatePreferenceRequest) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preference/search/index.js
var require_search8 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preference/search/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = search;
    var restClient_1 = require_restClient();
    function search({ options, config }) {
      return restClient_1.RestClient.fetch("/checkout/preferences/search", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, queryParams: Object.assign({}, options) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preference/index.js
var require_preference = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/preference/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Preference = void 0;
    var get_1 = __importDefault(require_get12());
    var create_1 = __importDefault(require_create10());
    var update_1 = __importDefault(require_update7());
    var search_1 = __importDefault(require_search8());
    var Preference2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Retrieve a single preference by its unique identifier.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/preference/get.ts Usage Example }.
       */
      get({ preferenceId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ id: preferenceId, config: this.config });
      }
      /**
       * Create a new Checkout Pro preference and obtain an `init_point` URL.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/preference/create.ts Usage Example }.
       */
      create({ body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ body, config: this.config });
      }
      /**
       * Update an existing preference (e.g. change items, amounts, or expiration).
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/preference/update.ts Usage Example }.
       */
      update({ id, updatePreferenceRequest, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, update_1.default)({ id, updatePreferenceRequest, config: this.config });
      }
      /**
       * Search preferences using filters such as external reference or sponsor.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/preference/search.ts Usage Example }.
       */
      search(preferenceSearchData = {}) {
        const { options, requestOptions } = preferenceSearchData;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, search_1.default)({ options, config: this.config });
      }
    };
    exports.Preference = Preference2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/oAuth/create/index.js
var require_create11 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/oAuth/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var restClient_1 = require_restClient();
    function create({ body, config }) {
      const defaultRequest = Object.assign(Object.assign({}, body), { "grant_type": "authorization_code" });
      return restClient_1.RestClient.fetch("/oauth/token", Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(defaultRequest) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/oAuth/refresh/index.js
var require_refresh = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/oAuth/refresh/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = refresh;
    var restClient_1 = require_restClient();
    function refresh({ body, config }) {
      const defaultRequest = Object.assign(Object.assign({}, body), { "grant_type": "refresh_token" });
      return restClient_1.RestClient.fetch("/oauth/token", Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(defaultRequest) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/oAuth/getAuthorizationURL/index.js
var require_getAuthorizationURL = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/oAuth/getAuthorizationURL/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = getAuthorizationURL;
    var restClient_1 = require_restClient();
    function getAuthorizationURL({ options }) {
      const defaultOptions = Object.assign(Object.assign({}, options), { response_type: "code", platform_id: "mp" });
      const AUTH_HOST = "https://auth.mercadopago.com/authorization";
      return restClient_1.RestClient.appendQueryParamsToUrl(AUTH_HOST, defaultOptions);
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/oAuth/index.js
var require_oAuth = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/oAuth/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.OAuth = void 0;
    var create_1 = __importDefault(require_create11());
    var refresh_1 = __importDefault(require_refresh());
    var getAuthorizationURL_1 = __importDefault(require_getAuthorizationURL());
    var OAuth2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Exchange an authorization code for an access token and refresh token.
       *
       * Call this after the seller is redirected back to your `redirect_uri`
       * with a temporary `code` query parameter.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/oauth/create.ts Usage Example }.
       */
      create({ body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ body, config: this.config });
      }
      /**
       * Obtain a new access token using a previously issued refresh token.
       *
       * Access tokens have a limited lifetime; call this method to rotate
       * credentials without requiring the seller to re-authorize.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/oauth/refresh.ts Usage Example }.
       */
      refresh({ body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, refresh_1.default)({ body, config: this.config });
      }
      /**
       * Build the MercadoPago authorization URL to which the seller should be redirected.
       *
       * The returned URL points to `auth.mercadopago.com` and includes the
       * required OAuth query parameters. Redirect the seller to this URL so
       * they can grant your application the requested permissions.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/oauth/getAuthorizationURL.ts Usage Example }.
       */
      getAuthorizationURL({ options }) {
        return (0, getAuthorizationURL_1.default)({ options });
      }
    };
    exports.OAuth = OAuth2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/merchantOrder/create/index.js
var require_create12 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/merchantOrder/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var restClient_1 = require_restClient();
    function create({ body, config }) {
      return restClient_1.RestClient.fetch("/merchant_orders", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body), method: "POST" }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/merchantOrder/get/index.js
var require_get13 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/merchantOrder/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function get({ merchantOrderId, config }) {
      return restClient_1.RestClient.fetch(`/merchant_orders/${(0, path_1.encodePathParam)(merchantOrderId)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/merchantOrder/update/index.js
var require_update8 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/merchantOrder/update/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = update;
    var restClient_1 = require_restClient();
    var path_1 = require_path();
    function update({ merchantOrderId, body, config }) {
      return restClient_1.RestClient.fetch(`/merchant_orders/${(0, path_1.encodePathParam)(merchantOrderId)}`, Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body), method: "PUT" }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/merchantOrder/search/index.js
var require_search9 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/merchantOrder/search/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = search;
    var restClient_1 = require_restClient();
    function search({ options, config }) {
      return restClient_1.RestClient.fetch("/merchant_orders/search", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, queryParams: Object.assign({}, options) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/merchantOrder/index.js
var require_merchantOrder = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/merchantOrder/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.MerchantOrder = void 0;
    var create_1 = __importDefault(require_create12());
    var get_1 = __importDefault(require_get13());
    var update_1 = __importDefault(require_update8());
    var search_1 = __importDefault(require_search9());
    var MerchantOrder2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Create a new merchant order.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/merchantOrder/create.ts Usage Example }.
       */
      create({ body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ body, config: this.config });
      }
      /**
       * Retrieve a merchant order by its ID.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/merchantOrder/get.ts Usage Example }.
       */
      get({ merchantOrderId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ merchantOrderId, config: this.config });
      }
      /**
       * Update an existing merchant order (items, shipments, notification URL, etc.).
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/merchantOrder/update.ts Usage Example }.
       */
      update({ merchantOrderId, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, update_1.default)({ merchantOrderId, body, config: this.config });
      }
      /**
       * Search merchant orders with optional filters such as status, payer, or date range.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/merchantOrder/search.ts Usage Example }.
       */
      search(merchantOrderSearchOptions = {}) {
        const { options, requestOptions } = merchantOrderSearchOptions;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, search_1.default)({ options, config: this.config });
      }
    };
    exports.MerchantOrder = MerchantOrder2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/user/get/index.js
var require_get14 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/user/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var restClient_1 = require_restClient();
    function get({ config }) {
      return restClient_1.RestClient.fetch("/users/me", Object.assign({ headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/user/index.js
var require_user = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/user/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.User = void 0;
    var get_1 = __importDefault(require_get14());
    var User2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Retrieve the profile of the authenticated user.
       *
       * Calls the `GET /users/me` endpoint and returns comprehensive account
       * information including personal data, reputation, and status.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/examples/user/get/get.ts Usage Example }.
       */
      get(userGetData = {}) {
        const { requestOptions } = userGetData;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ config: this.config });
      }
    };
    exports.User = User2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/create/index.js
var require_create13 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = create;
    var restClient_1 = require_restClient();
    function create({ body, config }) {
      return restClient_1.RestClient.fetch("/v1/orders", Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/get/index.js
var require_get15 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/get/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = get;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function get({ id, config }) {
      return restClient_1.RestClient.fetch(`/v1/orders/${(0, path_1.encodePathParam)(id)}`, Object.assign({ method: "GET", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/process/index.js
var require_process = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/process/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = process2;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function process2({ id, config }) {
      return restClient_1.RestClient.fetch(`/v1/orders/${(0, path_1.encodePathParam)(id)}/process`, Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/capture/index.js
var require_capture3 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/capture/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = capture;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function capture({ id, config }) {
      return restClient_1.RestClient.fetch(`/v1/orders/${(0, path_1.encodePathParam)(id)}/capture`, Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/cancel/index.js
var require_cancel3 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/cancel/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = cancel;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function cancel({ id, config }) {
      return restClient_1.RestClient.fetch(`/v1/orders/${(0, path_1.encodePathParam)(id)}/cancel`, Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/refund/index.js
var require_refund = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/refund/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = refund;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function refund({ id, body, config }) {
      return restClient_1.RestClient.fetch(`/v1/orders/${(0, path_1.encodePathParam)(id)}/refund`, Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/search/index.js
var require_search10 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/search/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = search;
    var restClient_1 = require_restClient();
    function search({ options, config }) {
      const queryParams = {};
      if (options) {
        for (const [key, value] of Object.entries(options)) {
          if (typeof value !== "undefined") {
            queryParams[key] = value;
          }
        }
      }
      return restClient_1.RestClient.fetch("/v1/orders", Object.assign({ method: "GET", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, queryParams }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/transaction/create/index.js
var require_create14 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/transaction/create/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = createTransaction;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function createTransaction({ id, body, config }) {
      return restClient_1.RestClient.fetch(`/v1/orders/${(0, path_1.encodePathParam)(id)}/transactions`, Object.assign({ method: "POST", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/transaction/update/index.js
var require_update9 = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/transaction/update/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = updateTransaction;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function updateTransaction({ id, transactionId, body, config }) {
      return restClient_1.RestClient.fetch(`/v1/orders/${(0, path_1.encodePathParam)(id)}/transactions/${(0, path_1.encodePathParam)(transactionId)}`, Object.assign({ method: "PUT", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      }, body: JSON.stringify(body) }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/transaction/delete/index.js
var require_delete = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/transaction/delete/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.default = deleteTransaction;
    var path_1 = require_path();
    var restClient_1 = require_restClient();
    function deleteTransaction({ id, transactionId, config }) {
      return restClient_1.RestClient.fetch(`/v1/orders/${(0, path_1.encodePathParam)(id)}/transactions/${(0, path_1.encodePathParam)(transactionId)}`, Object.assign({ method: "DELETE", headers: {
        "Authorization": `Bearer ${config.accessToken}`
      } }, config.options));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/index.js
var require_order = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/clients/order/index.js"(exports) {
    "use strict";
    var __importDefault = exports && exports.__importDefault || function(mod) {
      return mod && mod.__esModule ? mod : { "default": mod };
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Order = void 0;
    var create_1 = __importDefault(require_create13());
    var get_1 = __importDefault(require_get15());
    var process_1 = __importDefault(require_process());
    var capture_1 = __importDefault(require_capture3());
    var cancel_1 = __importDefault(require_cancel3());
    var refund_1 = __importDefault(require_refund());
    var search_1 = __importDefault(require_search10());
    var create_2 = __importDefault(require_create14());
    var update_1 = __importDefault(require_update9());
    var delete_1 = __importDefault(require_delete());
    var Order2 = class {
      constructor(mercadoPagoConfig) {
        this.config = mercadoPagoConfig;
      }
      /**
       * Create a new order.
       *
       * Sends a `POST /v1/orders` request with the provided order body.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/order/create.ts Usage Example}
       */
      create({ body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_1.default)({ body, config: this.config });
      }
      /**
       * Retrieve an existing order by its ID.
       *
       * Sends a `GET /v1/orders/{id}` request.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/order/get.ts Usage Example}
       */
      get({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, get_1.default)({ id, config: this.config });
      }
      /**
       * Process an order, triggering payment execution.
       *
       * Sends a `POST /v1/orders/{id}/process` request. The order must
       * already contain at least one payment transaction.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/order/process.ts Usage Example}
       */
      process({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, process_1.default)({ id, config: this.config });
      }
      /**
       * Capture an authorized order, confirming the payment settlement.
       *
       * Sends a `POST /v1/orders/{id}/capture` request. Only applicable
       * to orders created with `capture_mode: "manual"`.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/order/capture.ts Usage Example}
       */
      capture({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, capture_1.default)({ id, config: this.config });
      }
      /**
       * Cancel an order that has not yet been captured.
       *
       * Sends a `POST /v1/orders/{id}/cancel` request.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/order/cancel.ts Usage Example}
       */
      cancel({ id, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, cancel_1.default)({ id, config: this.config });
      }
      /**
       * Refund an order (total or partial).
       *
       * Sends a `POST /v1/orders/{id}/refund` request. Omit the body
       * for a full refund; provide specific transaction amounts for a
       * partial refund.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/order/refundTotal.ts Total Refund Example}
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/order/refundPartial.ts Partial Refund Example}
       */
      refund({ id, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, refund_1.default)({ id, body, config: this.config });
      }
      /**
       * Search orders by date range and optional filters.
       *
       * Sends a `GET /v1/orders` request with query parameters built from
       * the provided search options. Returns a paginated result set.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/order/search.ts Usage Example}
       */
      search(searchData) {
        const options = searchData === null || searchData === void 0 ? void 0 : searchData.options;
        const requestOptions = searchData === null || searchData === void 0 ? void 0 : searchData.requestOptions;
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, search_1.default)({ options, config: this.config });
      }
      /**
       * Add a payment transaction to an existing order.
       *
       * Sends a `POST /v1/orders/{id}/transactions` request.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/order/transaction/create.ts Usage Example}
       */
      createTransaction({ id, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, create_2.default)({ id, body, config: this.config });
      }
      /**
       * Update an existing payment transaction within an order.
       *
       * Sends a `PUT /v1/orders/{id}/transactions/{transactionId}` request.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/order/transaction/update.ts Usage Example}
       */
      updateTransaction({ id, transactionId, body, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, update_1.default)({ id, transactionId, body, config: this.config });
      }
      /**
       * Remove a payment transaction from an order.
       *
       * Sends a `DELETE /v1/orders/{id}/transactions/{transactionId}` request.
       *
       * @see {@link https://github.com/mercadopago/sdk-nodejs/blob/master/src/examples/order/transaction/delete.ts Usage Example}
       */
      deleteTransaction({ id, transactionId, requestOptions }) {
        this.config.options = Object.assign(Object.assign({}, this.config.options), requestOptions);
        return (0, delete_1.default)({ id, transactionId, config: this.config });
      }
    };
    exports.Order = Order2;
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/utils/webhook/index.js
var require_webhook = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/utils/webhook/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m2, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m2, k);
      if (!desc || ("get" in desc ? !m2.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m2[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m2, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m2[k];
    }));
    var __setModuleDefault = exports && exports.__setModuleDefault || (Object.create ? (function(o, v) {
      Object.defineProperty(o, "default", { enumerable: true, value: v });
    }) : function(o, v) {
      o["default"] = v;
    });
    var __importStar = exports && exports.__importStar || /* @__PURE__ */ (function() {
      var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function(o2) {
          var ar = [];
          for (var k in o2) if (Object.prototype.hasOwnProperty.call(o2, k)) ar[ar.length] = k;
          return ar;
        };
        return ownKeys(o);
      };
      return function(mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) {
          for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        }
        __setModuleDefault(result, mod);
        return result;
      };
    })();
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.WebhookSignatureValidator = exports.InvalidWebhookSignatureError = exports.SignatureFailureReason = void 0;
    var crypto = __importStar(__require("crypto"));
    var SignatureFailureReason2;
    (function(SignatureFailureReason3) {
      SignatureFailureReason3["MissingSignatureHeader"] = "MissingSignatureHeader";
      SignatureFailureReason3["MalformedSignatureHeader"] = "MalformedSignatureHeader";
      SignatureFailureReason3["MissingTimestamp"] = "MissingTimestamp";
      SignatureFailureReason3["MissingHash"] = "MissingHash";
      SignatureFailureReason3["SignatureMismatch"] = "SignatureMismatch";
      SignatureFailureReason3["TimestampOutOfTolerance"] = "TimestampOutOfTolerance";
    })(SignatureFailureReason2 || (exports.SignatureFailureReason = SignatureFailureReason2 = {}));
    var InvalidWebhookSignatureError2 = class _InvalidWebhookSignatureError extends Error {
      constructor(reason, requestId, timestamp) {
        super(`Invalid webhook signature: ${reason}`);
        this.name = "InvalidWebhookSignatureError";
        this.reason = reason;
        this.requestId = requestId;
        this.timestamp = timestamp;
        Object.setPrototypeOf(this, _InvalidWebhookSignatureError.prototype);
      }
    };
    exports.InvalidWebhookSignatureError = InvalidWebhookSignatureError2;
    var DEFAULT_VERSIONS = ["v1"];
    var VERSION_KEY_REGEX = /^v\d+$/;
    var WebhookSignatureValidator2 = class {
      /**
       * Validates the signature of a MercadoPago webhook notification.
       *
       * @param options - Validation inputs (see {@link ValidateOptions}).
       * @throws {@link InvalidWebhookSignatureError} when the signature is missing,
       *   malformed, or does not match the expected HMAC.
       */
      static validate(options) {
        var _a, _b;
        const xSignature = normalise(options.xSignature);
        const xRequestId = normalise(options.xRequestId);
        const dataId = normalise(options.dataId);
        const secret = options.secret;
        const supportedVersions = (_a = options.supportedVersions) !== null && _a !== void 0 ? _a : DEFAULT_VERSIONS;
        const toleranceSeconds = options.toleranceSeconds;
        const now = (_b = options.now) !== null && _b !== void 0 ? _b : (() => Date.now());
        if (!xSignature) {
          throw new InvalidWebhookSignatureError2(SignatureFailureReason2.MissingSignatureHeader, xRequestId);
        }
        const { ts, hashes } = parseSignatureHeader(xSignature);
        if (!ts && Object.keys(hashes).length === 0) {
          throw new InvalidWebhookSignatureError2(SignatureFailureReason2.MalformedSignatureHeader, xRequestId);
        }
        if (!ts) {
          throw new InvalidWebhookSignatureError2(SignatureFailureReason2.MissingTimestamp, xRequestId);
        }
        if (!/^\d+$/.test(ts)) {
          throw new InvalidWebhookSignatureError2(SignatureFailureReason2.MalformedSignatureHeader, xRequestId, ts);
        }
        let receivedHash;
        for (const version of supportedVersions) {
          if (hashes[version]) {
            receivedHash = hashes[version];
            break;
          }
        }
        if (!receivedHash) {
          throw new InvalidWebhookSignatureError2(SignatureFailureReason2.MissingHash, xRequestId, ts);
        }
        const manifest = buildManifest(dataId, xRequestId, ts);
        const computedHash = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
        if (!constantTimeEquals(computedHash, receivedHash)) {
          throw new InvalidWebhookSignatureError2(SignatureFailureReason2.SignatureMismatch, xRequestId, ts);
        }
        if (toleranceSeconds !== void 0) {
          const tsMs = Number(ts) * 1e3;
          const driftSeconds = Math.abs(now() - tsMs) / 1e3;
          if (driftSeconds > toleranceSeconds) {
            throw new InvalidWebhookSignatureError2(SignatureFailureReason2.TimestampOutOfTolerance, xRequestId, ts);
          }
        }
      }
    };
    exports.WebhookSignatureValidator = WebhookSignatureValidator2;
    function normalise(value) {
      if (value === void 0 || value === null)
        return void 0;
      const raw = Array.isArray(value) ? value[0] : value;
      if (raw === void 0 || raw === null)
        return void 0;
      const trimmed = String(raw).trim();
      return trimmed.length > 0 ? trimmed : void 0;
    }
    function parseSignatureHeader(header) {
      const hashes = {};
      let ts;
      for (const part of header.split(",")) {
        const eq = part.indexOf("=");
        if (eq === -1)
          continue;
        const key = part.substring(0, eq).trim().toLowerCase();
        const value = part.substring(eq + 1).trim();
        if (!key || !value)
          continue;
        if (key === "ts") {
          ts = value;
        } else if (VERSION_KEY_REGEX.test(key)) {
          hashes[key] = value;
        }
      }
      return { ts, hashes };
    }
    function buildManifest(dataId, requestId, ts) {
      const parts = [];
      if (dataId)
        parts.push(`id:${dataId}`);
      if (requestId)
        parts.push(`request-id:${requestId}`);
      parts.push(`ts:${ts}`);
      return parts.join(";") + ";";
    }
    function constantTimeEquals(a, b) {
      if (Buffer.byteLength(a) !== Buffer.byteLength(b))
        return false;
      return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    }
  }
});

// scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/index.js
var require_dist = __commonJS({
  "scripts/functions-catalog/2026-11/node_modules/mercadopago/dist/index.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.SignatureFailureReason = exports.InvalidWebhookSignatureError = exports.WebhookSignatureValidator = exports.buildError = exports.MPConnectionError = exports.MPServerError = exports.MPRateLimitError = exports.MPDependencyError = exports.MPResourceLockedError = exports.MPValidationError = exports.MPIdempotencyError = exports.MPNotFoundError = exports.MPForbiddenError = exports.MPPaymentError = exports.MPAuthenticationError = exports.MPBadRequestError = exports.MercadoPagoError = exports.Order = exports.User = exports.MerchantOrder = exports.OAuth = exports.Preference = exports.Point = exports.PreApprovalPlan = exports.PreApproval = exports.Payment = exports.PaymentMethod = exports.PaymentRefund = exports.IdentificationType = exports.Invoice = exports.DisbursementRefund = exports.Chargeback = exports.AdvancedPayment = exports.Customer = exports.CustomerCard = exports.CardToken = exports.MercadoPagoConfig = void 0;
    var mercadoPagoConfig_1 = require_mercadoPagoConfig();
    Object.defineProperty(exports, "MercadoPagoConfig", { enumerable: true, get: function() {
      return mercadoPagoConfig_1.MercadoPagoConfig;
    } });
    exports.default = mercadoPagoConfig_1.MercadoPagoConfig;
    var cardToken_1 = require_cardToken();
    Object.defineProperty(exports, "CardToken", { enumerable: true, get: function() {
      return cardToken_1.CardToken;
    } });
    var customerCard_1 = require_customerCard();
    Object.defineProperty(exports, "CustomerCard", { enumerable: true, get: function() {
      return customerCard_1.CustomerCard;
    } });
    var customer_1 = require_customer();
    Object.defineProperty(exports, "Customer", { enumerable: true, get: function() {
      return customer_1.Customer;
    } });
    var advancedPayment_1 = require_advancedPayment();
    Object.defineProperty(exports, "AdvancedPayment", { enumerable: true, get: function() {
      return advancedPayment_1.AdvancedPayment;
    } });
    var chargeback_1 = require_chargeback();
    Object.defineProperty(exports, "Chargeback", { enumerable: true, get: function() {
      return chargeback_1.Chargeback;
    } });
    var disbursementRefund_1 = require_disbursementRefund();
    Object.defineProperty(exports, "DisbursementRefund", { enumerable: true, get: function() {
      return disbursementRefund_1.DisbursementRefund;
    } });
    var invoice_1 = require_invoice();
    Object.defineProperty(exports, "Invoice", { enumerable: true, get: function() {
      return invoice_1.Invoice;
    } });
    var identificationType_1 = require_identificationType();
    Object.defineProperty(exports, "IdentificationType", { enumerable: true, get: function() {
      return identificationType_1.IdentificationType;
    } });
    var paymentRefund_1 = require_paymentRefund();
    Object.defineProperty(exports, "PaymentRefund", { enumerable: true, get: function() {
      return paymentRefund_1.PaymentRefund;
    } });
    var paymentMethod_1 = require_paymentMethod();
    Object.defineProperty(exports, "PaymentMethod", { enumerable: true, get: function() {
      return paymentMethod_1.PaymentMethod;
    } });
    var payment_1 = require_payment();
    Object.defineProperty(exports, "Payment", { enumerable: true, get: function() {
      return payment_1.Payment;
    } });
    var preApproval_1 = require_preApproval();
    Object.defineProperty(exports, "PreApproval", { enumerable: true, get: function() {
      return preApproval_1.PreApproval;
    } });
    var preApprovalPlan_1 = require_preApprovalPlan();
    Object.defineProperty(exports, "PreApprovalPlan", { enumerable: true, get: function() {
      return preApprovalPlan_1.PreApprovalPlan;
    } });
    var point_1 = require_point();
    Object.defineProperty(exports, "Point", { enumerable: true, get: function() {
      return point_1.Point;
    } });
    var preference_1 = require_preference();
    Object.defineProperty(exports, "Preference", { enumerable: true, get: function() {
      return preference_1.Preference;
    } });
    var oAuth_1 = require_oAuth();
    Object.defineProperty(exports, "OAuth", { enumerable: true, get: function() {
      return oAuth_1.OAuth;
    } });
    var merchantOrder_1 = require_merchantOrder();
    Object.defineProperty(exports, "MerchantOrder", { enumerable: true, get: function() {
      return merchantOrder_1.MerchantOrder;
    } });
    var user_1 = require_user();
    Object.defineProperty(exports, "User", { enumerable: true, get: function() {
      return user_1.User;
    } });
    var order_1 = require_order();
    Object.defineProperty(exports, "Order", { enumerable: true, get: function() {
      return order_1.Order;
    } });
    var errors_1 = require_errors();
    Object.defineProperty(exports, "MercadoPagoError", { enumerable: true, get: function() {
      return errors_1.MercadoPagoError;
    } });
    Object.defineProperty(exports, "MPBadRequestError", { enumerable: true, get: function() {
      return errors_1.MPBadRequestError;
    } });
    Object.defineProperty(exports, "MPAuthenticationError", { enumerable: true, get: function() {
      return errors_1.MPAuthenticationError;
    } });
    Object.defineProperty(exports, "MPPaymentError", { enumerable: true, get: function() {
      return errors_1.MPPaymentError;
    } });
    Object.defineProperty(exports, "MPForbiddenError", { enumerable: true, get: function() {
      return errors_1.MPForbiddenError;
    } });
    Object.defineProperty(exports, "MPNotFoundError", { enumerable: true, get: function() {
      return errors_1.MPNotFoundError;
    } });
    Object.defineProperty(exports, "MPIdempotencyError", { enumerable: true, get: function() {
      return errors_1.MPIdempotencyError;
    } });
    Object.defineProperty(exports, "MPValidationError", { enumerable: true, get: function() {
      return errors_1.MPValidationError;
    } });
    Object.defineProperty(exports, "MPResourceLockedError", { enumerable: true, get: function() {
      return errors_1.MPResourceLockedError;
    } });
    Object.defineProperty(exports, "MPDependencyError", { enumerable: true, get: function() {
      return errors_1.MPDependencyError;
    } });
    Object.defineProperty(exports, "MPRateLimitError", { enumerable: true, get: function() {
      return errors_1.MPRateLimitError;
    } });
    Object.defineProperty(exports, "MPServerError", { enumerable: true, get: function() {
      return errors_1.MPServerError;
    } });
    Object.defineProperty(exports, "MPConnectionError", { enumerable: true, get: function() {
      return errors_1.MPConnectionError;
    } });
    Object.defineProperty(exports, "buildError", { enumerable: true, get: function() {
      return errors_1.buildError;
    } });
    var webhook_1 = require_webhook();
    Object.defineProperty(exports, "WebhookSignatureValidator", { enumerable: true, get: function() {
      return webhook_1.WebhookSignatureValidator;
    } });
    Object.defineProperty(exports, "InvalidWebhookSignatureError", { enumerable: true, get: function() {
      return webhook_1.InvalidWebhookSignatureError;
    } });
    Object.defineProperty(exports, "SignatureFailureReason", { enumerable: true, get: function() {
      return webhook_1.SignatureFailureReason;
    } });
  }
});

// scripts/functions-catalog/2026-11/openlen-mercadopago.mjs
var import_mercadopago = __toESM(require_dist(), 1);
var openlen_mercadopago_default = import_mercadopago.default;
var { AdvancedPayment, CardToken, Chargeback, Customer, CustomerCard, DisbursementRefund, IdentificationType, InvalidWebhookSignatureError, Invoice, MPAuthenticationError, MPBadRequestError, MPConnectionError, MPDependencyError, MPForbiddenError, MPIdempotencyError, MPNotFoundError, MPPaymentError, MPRateLimitError, MPResourceLockedError, MPServerError, MPValidationError, MercadoPagoConfig, MercadoPagoError, MerchantOrder, OAuth, Order, Payment, PaymentMethod, PaymentRefund, Point, PreApproval, PreApprovalPlan, Preference, SignatureFailureReason, User, WebhookSignatureValidator, buildError } = import_mercadopago.default;
export {
  AdvancedPayment,
  CardToken,
  Chargeback,
  Customer,
  CustomerCard,
  DisbursementRefund,
  IdentificationType,
  InvalidWebhookSignatureError,
  Invoice,
  MPAuthenticationError,
  MPBadRequestError,
  MPConnectionError,
  MPDependencyError,
  MPForbiddenError,
  MPIdempotencyError,
  MPNotFoundError,
  MPPaymentError,
  MPRateLimitError,
  MPResourceLockedError,
  MPServerError,
  MPValidationError,
  MercadoPagoConfig,
  MercadoPagoError,
  MerchantOrder,
  OAuth,
  Order,
  Payment,
  PaymentMethod,
  PaymentRefund,
  Point,
  PreApproval,
  PreApprovalPlan,
  Preference,
  SignatureFailureReason,
  User,
  WebhookSignatureValidator,
  buildError,
  openlen_mercadopago_default as default
};
