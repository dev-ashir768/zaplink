import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageService } from './message.service';
import { MessageSendService } from './message-send.service';
import { BulkMessageService } from './bulk-message.service';
import { MessageTypeBackfillService } from './message-type-backfill.service';
import { PendingMessageReaperService } from './pending-message-reaper.service';
import { MessageRetentionService } from './message-retention.service';
import { MessageController } from './message.controller';
import { SessionModule } from '../session/session.module';
import { TemplateModule } from '../template/template.module';
import { ChatMediaModule } from '../chat-media/chat-media.module';
import { Message } from './entities/message.entity';
import { Session } from '../session/entities/session.entity';
import { SendPacingService } from './send-pacing.service';
import { MessageBatch } from './entities/message-batch.entity';
import { SendIdempotencyKey } from './entities/send-idempotency-key.entity';
import { SendIdempotencyService } from './idempotency/send-idempotency.service';
import { SendIdempotencyInterceptor } from './idempotency/send-idempotency.interceptor';

@Module({
  imports: [
    TypeOrmModule.forFeature([Message, MessageBatch, Session, SendIdempotencyKey], 'data'),
    SessionModule,
    TemplateModule,
    ChatMediaModule,
  ],
  controllers: [MessageController],
  providers: [
    MessageService,
    MessageSendService,
    BulkMessageService,
    MessageTypeBackfillService,
    PendingMessageReaperService,
    MessageRetentionService,
    SendPacingService,
    SendIdempotencyService,
    SendIdempotencyInterceptor,
  ],
  exports: [MessageService, BulkMessageService, SendPacingService, SendIdempotencyService],
})
export class MessageModule {}
