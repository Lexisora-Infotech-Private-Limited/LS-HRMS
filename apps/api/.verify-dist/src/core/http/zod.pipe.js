"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ZodPipe", {
    enumerable: true,
    get: function() {
        return ZodPipe;
    }
});
const _common = require("@nestjs/common");
let ZodPipe = class ZodPipe {
    schema;
    constructor(schema){
        this.schema = schema;
    }
    transform(value) {
        const r = this.schema.safeParse(value);
        if (!r.success) {
            throw new _common.BadRequestException({
                code: 'VALIDATION_FAILED',
                message: r.error.issues[0]?.message ?? 'Invalid input',
                details: r.error.flatten()
            });
        }
        return r.data;
    }
};

//# sourceMappingURL=zod.pipe.js.map