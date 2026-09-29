import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CoreModule } from './core/core.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PeopleModule } from './modules/people/people.module';
import { TimeModule } from './modules/time/time.module';
import { TrackerModule } from './modules/tracker/tracker.module';
import { LeavepayModule } from './modules/leavepay/leavepay.module';
import { WorkModule } from './modules/work/work.module';
import { FinanceModule } from './modules/finance/finance.module';
import { WorkplaceModule } from './modules/workplace/workplace.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    CoreModule,
    PlatformModule,
    PeopleModule,
    TimeModule,
    TrackerModule,
    LeavepayModule,
    WorkModule,
    FinanceModule,
    WorkplaceModule,
  ],
})
export class AppModule {}
