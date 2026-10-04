"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "WorkModule", {
    enumerable: true,
    get: function() {
        return WorkModule;
    }
});
const _common = require("@nestjs/common");
const _clientscontroller = require("./clients/clients.controller");
const _clientsservice = require("./clients/clients.service");
const _projectscontroller = require("./projects/projects.controller");
const _projectsservice = require("./projects/projects.service");
const _workmetricsservice = require("./projects/work-metrics.service");
const _workdocsservice = require("./projects/work-docs.service");
const _taskscontroller = require("./tasks/tasks.controller");
const _tasksservice = require("./tasks/tasks.service");
const _boardsservice = require("./boards/boards.service");
const _gitcontroller = require("./git/git.controller");
const _gitservice = require("./git/git.service");
const _archivecontroller = require("./archive/archive.controller");
const _archiveservice = require("./archive/archive.service");
const _internscontroller = require("./interns/interns.controller");
const _internsservice = require("./interns/interns.service");
const _workaccessservice = require("./work-access.service");
const _workeventsservice = require("./work-events.service");
const _workregistryservice = require("./work-registry.service");
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
let WorkModule = class WorkModule {
};
WorkModule = _ts_decorate([
    (0, _common.Module)({
        imports: [],
        controllers: [
            _clientscontroller.ClientsController,
            _projectscontroller.ProjectsController,
            _taskscontroller.TasksController,
            _taskscontroller.BoardsController,
            _gitcontroller.GitController,
            _archivecontroller.ArchiveController,
            _internscontroller.InternsController
        ],
        providers: [
            _workaccessservice.WorkAccessService,
            _workeventsservice.WorkEvents,
            _workdocsservice.WorkDocsService,
            _workmetricsservice.WorkMetricsService,
            _gitservice.GitService,
            _clientsservice.ClientsService,
            _projectsservice.ProjectsService,
            _tasksservice.TasksService,
            _boardsservice.BoardsService,
            _archiveservice.ArchiveService,
            _internsservice.InternsService,
            _workregistryservice.WorkRegistry
        ],
        exports: [
            _tasksservice.TasksService,
            _workmetricsservice.WorkMetricsService
        ]
    })
], WorkModule);

//# sourceMappingURL=work.module.js.map