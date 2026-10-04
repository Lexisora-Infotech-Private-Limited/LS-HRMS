"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "JobsService", {
    enumerable: true,
    get: function() {
        return JobsService;
    }
});
const _common = require("@nestjs/common");
const _bullmq = require("bullmq");
const _ioredis = /*#__PURE__*/ _interop_require_default(require("ioredis"));
const _env = require("../../config/env");
const _requestcontext = require("../context/request-context");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
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
let JobsService = class JobsService {
    log = new _common.Logger('Jobs');
    handlers = new Map();
    connection;
    queue;
    worker;
    inline = _env.env.JOBS_DISABLED;
    ensure() {
        if (this.inline || this.queue) return;
        try {
            this.connection = new _ioredis.default(_env.env.REDIS_URL, {
                maxRetriesPerRequest: null,
                lazyConnect: false
            });
            this.connection.on('error', (e)=>this.log.warn(`Redis: ${e.message}`));
            this.queue = new _bullmq.Queue('hrms', {
                connection: this.connection
            });
            this.worker = new _bullmq.Worker('hrms', async (job)=>this.run(job.name, job.data), {
                connection: this.connection,
                concurrency: 4
            });
            this.worker.on('failed', (job, err)=>this.log.error(`Job ${job?.name} failed: ${err.message}`));
        } catch (e) {
            this.log.warn(`Queue unavailable, running jobs inline: ${e.message}`);
            this.inline = true;
        }
    }
    register(name, handler) {
        this.handlers.set(name, handler);
        this.ensure();
    }
    async enqueue(name, data, opts) {
        this.ensure();
        if (this.inline || !this.queue) {
            setImmediate(()=>void this.run(name, data).catch((e)=>this.log.error(`${name}: ${e.message}`)));
            return;
        }
        await this.queue.add(name, data, {
            removeOnComplete: 1000,
            removeOnFail: 5000,
            attempts: 3,
            backoff: {
                type: 'exponential',
                delay: 5000
            },
            ...opts
        });
    }
    async run(name, data) {
        const h = this.handlers.get(name);
        if (!h) throw new Error(`No handler for job ${name}`);
        return data?.tenantId ? (0, _requestcontext.runAsTenant)(data.tenantId, ()=>h(data)) : h(data);
    }
    async onModuleDestroy() {
        await this.worker?.close();
        await this.queue?.close();
        this.connection?.disconnect();
    }
};
JobsService = _ts_decorate([
    (0, _common.Injectable)()
], JobsService);

//# sourceMappingURL=jobs.service.js.map