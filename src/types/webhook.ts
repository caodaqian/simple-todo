export type WebhookPlatform = 'feishu' | 'dingtalk';

export type WebhookEventType = 'task.due' | 'task.completed' | 'digest.daily';

export interface WebhookTargetSettings {
	enabled: boolean;
	events: WebhookEventType[];
	keyword?: string;
}

export interface DailyDigestSettings {
	enabled: boolean;
	time: string;
	timezone: string;
}

export interface WebhookSettings {
	feishu: WebhookTargetSettings;
	dingtalk: WebhookTargetSettings;
	dailyDigest: DailyDigestSettings;
}

export interface WebhookTargetStatus {
	platform: WebhookPlatform;
	configured: boolean;
	endpointLabel?: string;
}

export interface WebhookTaskSnapshot {
	id: string;
	title: string;
	description: string;
	priority: 'low' | 'medium' | 'high' | 'urgent';
	tags: string[];
	group: string;
	dueAt?: number;
	completedAt?: number;
}

export interface WebhookDigestSnapshot {
	periodStart: number;
	periodEnd: number;
	timezone: string;
	completed: WebhookTaskSnapshot[];
	overdue: WebhookTaskSnapshot[];
	due: WebhookTaskSnapshot[];
	activeCount: number;
}

interface WebhookDomainEventBase {
	id: string;
	occurredAt: number;
}

export type WebhookDomainEvent =
	| WebhookDomainEventBase & {
		type: 'task.due';
		payload: { task: WebhookTaskSnapshot; reminderAt: number };
	}
	| WebhookDomainEventBase & {
		type: 'task.completed';
		payload: { task: WebhookTaskSnapshot };
	}
	| WebhookDomainEventBase & {
		type: 'digest.daily';
		payload: { digest: WebhookDigestSnapshot };
	};

export type WebhookDeliveryStatus = 'pending' | 'sending' | 'succeeded' | 'blocked';

export type WebhookErrorCode =
	| 'network_error'
	| 'timeout'
	| 'rate_limited'
	| 'server_error'
	| 'invalid_credentials'
	| 'keyword_mismatch'
	| 'invalid_request'
	| 'unknown';

export interface WebhookDeliveryRecord {
	id: string;
	eventId: string;
	platform: WebhookPlatform;
	status: WebhookDeliveryStatus;
	attempts: number;
	createdAt: number;
	updatedAt: number;
	nextAttemptAt?: number;
	leaseExpiresAt?: number;
	succeededAt?: number;
	errorCode?: WebhookErrorCode;
}
