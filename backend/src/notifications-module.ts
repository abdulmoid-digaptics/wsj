import {Module} from '@nestjs/common';
import {CustomerAuthService, CustomerGuard} from './account-auth';
import {AuthGuard, Db} from './core';
import {MailService, OutboxService} from './mail';
import {NotificationGuard, NotificationsController, NotificationService} from './notifications';
import {PaymentClient} from './payments';

// Both modules share the same database, session guards and infrastructure providers.
const infrastructure = [Db, AuthGuard, PaymentClient, MailService, OutboxService, CustomerAuthService, CustomerGuard];
@Module({providers: infrastructure, exports: infrastructure})
export class NotificationDependenciesModule {}

@Module({imports: [NotificationDependenciesModule], controllers: [NotificationsController], providers: [NotificationGuard, NotificationService], exports: [NotificationService]})
export class NotificationsModule {}
