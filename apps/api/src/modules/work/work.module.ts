import { Module } from '@nestjs/common';
import { ClientsController } from './clients/clients.controller';
import { ClientsService } from './clients/clients.service';
import { ProjectsController } from './projects/projects.controller';
import { ProjectsService } from './projects/projects.service';
import { WorkMetricsService } from './projects/work-metrics.service';
import { WorkDocsService } from './projects/work-docs.service';
import { BoardsController, TasksController } from './tasks/tasks.controller';
import { TasksService } from './tasks/tasks.service';
import { BoardsService } from './boards/boards.service';
import { GitController } from './git/git.controller';
import { GitService } from './git/git.service';
import { ArchiveController } from './archive/archive.controller';
import { ArchiveService } from './archive/archive.service';
import { InternsController } from './interns/interns.controller';
import { InternsService } from './interns/interns.service';
import { WorkAccessService } from './work-access.service';
import { WorkEvents } from './work-events.service';
import { WorkRegistry } from './work-registry.service';

/**
 * Work domain — clients, projects, department team boards, tasks + GitLab, archive & client vault,
 * intern task sheets. See docs/specs/spec-workfin.md and docs/ARCHITECTURE.md §4 (spine models).
 * Imports nothing from other domains; reads time/tracker spine models directly via Prisma.
 */
@Module({
  imports: [],
  controllers: [ClientsController, ProjectsController, TasksController, BoardsController, GitController, ArchiveController, InternsController],
  providers: [
    WorkAccessService,
    WorkEvents,
    WorkDocsService,
    WorkMetricsService,
    GitService,
    ClientsService,
    ProjectsService,
    TasksService,
    BoardsService,
    ArchiveService,
    InternsService,
    WorkRegistry,
  ],
  exports: [TasksService, WorkMetricsService],
})
export class WorkModule {}
