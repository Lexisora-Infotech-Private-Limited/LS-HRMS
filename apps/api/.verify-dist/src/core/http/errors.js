"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: Object.getOwnPropertyDescriptor(all, name).get
    });
}
_export(exports, {
    get AllExceptionsFilter () {
        return AllExceptionsFilter;
    },
    get AppError () {
        return AppError;
    },
    get badRequest () {
        return badRequest;
    },
    get conflict () {
        return conflict;
    },
    get forbidden () {
        return forbidden;
    },
    get notFound () {
        return notFound;
    }
});
const _common = require("@nestjs/common");
const _client = require("@prisma/client");
function _ts_decorate(decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") {
        r = Reflect.decorate(decorators, target, key, desc);
    } else {
        for(var i = decorators.length - 1; i >= 0; i--){
            if (d = decorators[i]) {
                r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
            }
        }
    }
    return c > 3 && r && Object.defineProperty(target, key, r), r;
}
let AppError = class AppError extends _common.HttpException {
    constructor(status, code, message, details){
        super({
            code,
            message,
            details
        }, status);
    }
};
const notFound = (what = 'Record')=>new AppError(404, 'NOT_FOUND', `${what} not found`);
const forbidden = (message = 'You do not have access to this')=>new AppError(403, 'FORBIDDEN', message);
const badRequest = (message, code = 'BAD_REQUEST', details)=>new AppError(400, code, message, details);
const conflict = (message, code = 'CONFLICT')=>new AppError(409, code, message);
let AllExceptionsFilter = class AllExceptionsFilter {
    log = new _common.Logger('Http');
    catch(exception, host) {
        if (host.getType() !== 'http') throw exception;
        const res = host.switchToHttp().getResponse();
        let body;
        if (exception instanceof _common.HttpException) {
            const status = exception.getStatus();
            const r = exception.getResponse();
            body = {
                statusCode: status,
                code: r?.code ?? _common.HttpStatus[status] ?? 'ERROR',
                message: Array.isArray(r?.message) ? r.message.join(', ') : r?.message ?? exception.message,
                details: r?.details
            };
        } else if (exception instanceof _client.Prisma.PrismaClientKnownRequestError) {
            if (exception.code === 'P2002') {
                body = {
                    statusCode: 409,
                    code: 'DUPLICATE',
                    message: 'A record with these details already exists',
                    details: exception.meta
                };
            } else if (exception.code === 'P2025') {
                body = {
                    statusCode: 404,
                    code: 'NOT_FOUND',
                    message: 'Record not found'
                };
            } else {
                this.log.error(exception);
                body = {
                    statusCode: 500,
                    code: 'DB_ERROR',
                    message: 'Database error'
                };
            }
        } else {
            this.log.error(exception instanceof Error ? exception.stack : exception);
            body = {
                statusCode: 500,
                code: 'INTERNAL',
                message: 'Something went wrong'
            };
        }
        res.status(body.statusCode).json(body);
    }
};
AllExceptionsFilter = _ts_decorate([
    (0, _common.Catch)()
], AllExceptionsFilter);

//# sourceMappingURL=errors.js.map