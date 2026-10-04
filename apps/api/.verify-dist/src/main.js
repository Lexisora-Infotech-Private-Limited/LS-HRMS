"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
require("reflect-metadata");
const _common = require("@nestjs/common");
const _core = require("@nestjs/core");
const _cookieparser = /*#__PURE__*/ _interop_require_default(require("cookie-parser"));
const _env = require("./config/env");
const _appmodule = require("./app.module");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
async function bootstrap() {
    const app = await _core.NestFactory.create(_appmodule.AppModule, {
        bufferLogs: false
    });
    app.setGlobalPrefix('api/v1');
    app.set('trust proxy', 1);
    app.use((0, _cookieparser.default)());
    app.useBodyParser('json', {
        limit: '10mb'
    });
    app.enableCors({
        origin: [
            _env.env.WEB_ORIGIN,
            /^http:\/\/localhost:\d+$/
        ],
        credentials: true
    });
    app.enableShutdownHooks();
    await app.listen(_env.env.PORT);
    _common.Logger.log(`API listening on http://localhost:${_env.env.PORT}/api/v1`, 'Bootstrap');
}
void bootstrap();

//# sourceMappingURL=main.js.map