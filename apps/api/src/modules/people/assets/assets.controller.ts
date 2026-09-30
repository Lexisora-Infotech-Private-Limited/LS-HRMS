import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  assetCategorySchema,
  assetListQuery,
  assetSchema,
  assignAssetSchema,
  inspectAssetSchema,
  issueKitSchema,
  kitItemSchema,
  kitLineSchema,
  lostAssetSchema,
  repairAssetSchema,
  repairCompleteSchema,
  returnAssetSchema,
  type AssetInput,
} from '@lexisora/shared';
import { RequirePerm } from '../../../core/auth/decorators';
import { ZodPipe } from '../../../core/http/zod.pipe';
import { KitsService } from '../kits/kits.service';
import { MastersService } from '../masters/masters.service';
import { AssetsService } from './assets.service';

@Controller('assets')
export class AssetsController {
  constructor(
    private readonly assets: AssetsService,
    private readonly masters: MastersService,
  ) {}

  @Get()
  @RequirePerm('assets.manage')
  list(@Query(new ZodPipe(assetListQuery)) q: z.infer<typeof assetListQuery>) {
    return this.assets.list(q);
  }

  @Get('categories')
  @RequirePerm('assets.manage')
  categories() {
    return this.masters.assetCategories();
  }

  @Post('categories')
  @RequirePerm('assets.manage')
  createCategory(@Body(new ZodPipe(assetCategorySchema)) dto: z.infer<typeof assetCategorySchema>) {
    return this.masters.createAssetCategory(dto);
  }

  /** Employee acknowledges receipt of an assigned asset (own profile). */
  @Post('assignments/:id/acknowledge')
  @HttpCode(200)
  acknowledge(@Param('id') id: string) {
    return this.assets.acknowledge(id);
  }

  @Get(':id')
  @RequirePerm('assets.manage')
  detail(@Param('id') id: string) {
    return this.assets.detail(id);
  }

  @Post()
  @RequirePerm('assets.manage')
  create(@Body(new ZodPipe(assetSchema)) dto: AssetInput) {
    return this.assets.create(dto);
  }

  @Put(':id')
  @RequirePerm('assets.manage')
  update(@Param('id') id: string, @Body(new ZodPipe(assetSchema)) dto: AssetInput) {
    return this.assets.update(id, dto);
  }

  @Post(':id/assign')
  @RequirePerm('assets.manage')
  @HttpCode(200)
  assign(@Param('id') id: string, @Body(new ZodPipe(assignAssetSchema)) dto: z.infer<typeof assignAssetSchema>) {
    return this.assets.assign(id, dto.employeeId, dto.assignedOn);
  }

  @Post(':id/return')
  @RequirePerm('assets.manage')
  @HttpCode(200)
  returnAsset(@Param('id') id: string, @Body(new ZodPipe(returnAssetSchema)) dto: z.infer<typeof returnAssetSchema>) {
    return this.assets.returnAsset(id, dto.condition, dto.notes, dto.returnedOn);
  }

  @Post(':id/inspect')
  @RequirePerm('assets.manage')
  @HttpCode(200)
  inspect(@Param('id') id: string, @Body(new ZodPipe(inspectAssetSchema)) dto: z.infer<typeof inspectAssetSchema>) {
    return this.assets.inspect(id, dto.to);
  }

  @Post(':id/repair')
  @RequirePerm('assets.manage')
  @HttpCode(200)
  repair(@Param('id') id: string, @Body(new ZodPipe(repairAssetSchema)) dto: z.infer<typeof repairAssetSchema>) {
    return this.assets.repair(id, dto.issue, dto.vendor, dto.expectedBack);
  }

  @Post(':id/repair/complete')
  @RequirePerm('assets.manage')
  @HttpCode(200)
  repairDone(@Param('id') id: string, @Body(new ZodPipe(repairCompleteSchema)) dto: z.infer<typeof repairCompleteSchema>) {
    return this.assets.repairComplete(id, dto.costPaise);
  }

  @Post(':id/lost')
  @RequirePerm('assets.manage')
  @HttpCode(200)
  lost(@Param('id') id: string, @Body(new ZodPipe(lostAssetSchema)) dto: z.infer<typeof lostAssetSchema>) {
    return this.assets.lost(id, dto.note);
  }
}

@Controller('welcome-kits')
export class WelcomeKitsController {
  constructor(private readonly kits: KitsService) {}

  @Get()
  @RequirePerm('welcomekit.manage')
  list(@Query('status') status?: string) {
    return this.kits.list(status || undefined);
  }

  @Get('items')
  @RequirePerm('welcomekit.manage')
  items() {
    return this.kits.items();
  }

  @Post('items')
  @RequirePerm('welcomekit.manage')
  createItem(@Body(new ZodPipe(kitItemSchema)) dto: z.infer<typeof kitItemSchema>) {
    return this.kits.createItem(dto);
  }

  @Put('items/:id')
  @RequirePerm('welcomekit.manage')
  updateItem(@Param('id') id: string, @Body(new ZodPipe(kitItemSchema)) dto: z.infer<typeof kitItemSchema>) {
    return this.kits.updateItem(id, dto);
  }

  @Post('issue')
  @RequirePerm('welcomekit.manage')
  @HttpCode(200)
  issue(@Body(new ZodPipe(issueKitSchema)) dto: z.infer<typeof issueKitSchema>) {
    return this.kits.issue(dto.employeeId, dto.itemIds, dto.issuedOn, dto.force);
  }

  @Put(':issueId/lines/:itemId')
  @RequirePerm('welcomekit.manage')
  toggle(@Param('issueId') issueId: string, @Param('itemId') itemId: string, @Body(new ZodPipe(kitLineSchema)) dto: z.infer<typeof kitLineSchema>) {
    return this.kits.toggleLine(issueId, itemId, dto.issued, dto.size, dto.force);
  }
}
