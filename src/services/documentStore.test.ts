import { afterEach, describe, expect, it } from 'vitest';
import { createDocumentStore, type DocumentRecord } from './documentStore';

interface Note {
	title: string;
	metadata?: {
		tags: string[];
	};
}

class MockDocumentDb implements UtoolsDb {
	private readonly documents = new Map<string, UtoolsDbDocument>();

	private revision = 0;

	nextPutResult: UtoolsDbResult | null = null;

	nextRemoveResult: UtoolsDbResult | null = null;

	nextBulkResults: UtoolsDbResult[] | null = null;

	nextGetError: Error | null = null;

	get(id: string): UtoolsDbDocument | null {
		if (this.nextGetError !== null) {
			const error = this.nextGetError;
			this.nextGetError = null;
			throw error;
		}
		return this.documents.get(id) ?? null;
	}

	put(document: UtoolsDbDocument): UtoolsDbResult {
		if (this.nextPutResult) {
			const result = this.nextPutResult;
			this.nextPutResult = null;
			return result;
		}
		const current = this.documents.get(document._id);
		if (current !== undefined && document._rev !== current._rev) {
			return { ok: false, error: true, name: 'conflict' };
		}
		this.revision += 1;
		const rev = `rev-${this.revision}`;
		this.documents.set(document._id, { ...document, _rev: rev });
		return { ok: true, rev };
	}

	remove(document: UtoolsDbDocument): UtoolsDbResult {
		if (this.nextRemoveResult) {
			const result = this.nextRemoveResult;
			this.nextRemoveResult = null;
			return result;
		}
		const current = this.documents.get(document._id);
		if (current !== undefined && document._rev !== current._rev) {
			return { ok: false, error: true, name: 'conflict' };
		}
		this.documents.delete(document._id);
		return { ok: true, rev: 'deleted-rev' };
	}

	bulkDocs(documents: UtoolsDbDocument[]): UtoolsDbResult[] {
		if (this.nextBulkResults) {
			const results = this.nextBulkResults;
			this.nextBulkResults = null;
			return results;
		}
		return documents.map((document) => this.put(document));
	}

	allDocs(prefix?: string): UtoolsDbDocument[] {
		return [...this.documents.values()].filter((document) => prefix === undefined || document._id.startsWith(prefix));
	}
}

const note = (id: string, title: string, rev?: string): DocumentRecord<Note> => ({
	_id: id,
	...(rev === undefined ? {} : { _rev: rev }),
	data: { title },
});

const setDocumentDb = (db: UtoolsDb): void => {
	Reflect.set(window, 'utools', { db });
};

const clearUtools = (): void => {
	Reflect.deleteProperty(window, 'utools');
};

describe('documentStore', () => {
	afterEach(() => {
		clearUtools();
	});

	it('creates and reads a document through uTools db', () => {
		const db = new MockDocumentDb();
		setDocumentDb(db);
		const store = createDocumentStore<Note>();

		expect(store.write(note('jianyue/task/1', '第一项'))).toEqual({ status: 'ok', rev: 'rev-1' });
		expect(store.get('jianyue/task/1')).toEqual(note('jianyue/task/1', '第一项', 'rev-1'));
	});

	it('lists only documents matching an id prefix', () => {
		const db = new MockDocumentDb();
		setDocumentDb(db);
		const store = createDocumentStore<Note>();
		store.write(note('jianyue/task/1', '任务'));
		store.write(note('jianyue/template/1', '模板'));

		expect(store.list('jianyue/task/')).toEqual([note('jianyue/task/1', '任务', 'rev-1')]);
	});

	it('passes a caller-provided revision when updating an existing document', () => {
		const db = new MockDocumentDb();
		setDocumentDb(db);
		const store = createDocumentStore<Note>();
		store.write(note('jianyue/task/1', '初稿'));

		expect(store.write(note('jianyue/task/1', '修订稿', 'rev-1'))).toEqual({ status: 'ok', rev: 'rev-2' });
		expect(db.get('jianyue/task/1')).toEqual(note('jianyue/task/1', '修订稿', 'rev-2'));
	});

	it('rejects a native db update that omits the current revision', () => {
		const db = new MockDocumentDb();
		setDocumentDb(db);
		const store = createDocumentStore<Note>();
		store.write(note('jianyue/task/1', '初稿'));

		expect(store.write(note('jianyue/task/1', '无版本覆盖'))).toEqual({
			status: 'conflict',
			message: 'A current _rev is required to update this document.',
		});
		expect(db.get('jianyue/task/1')).toEqual(note('jianyue/task/1', '初稿', 'rev-1'));
	});

	it('returns conflict and error results reported by uTools db', () => {
		const db = new MockDocumentDb();
		setDocumentDb(db);
		const store = createDocumentStore<Note>();
		db.nextPutResult = { ok: false, error: true, message: 'Document update conflict' };

		expect(store.write(note('jianyue/task/1', '冲突'))).toEqual({ status: 'conflict', message: 'Document update conflict' });

		db.nextPutResult = { ok: false, error: true, message: 'disk unavailable' };
		expect(store.write(note('jianyue/task/1', '失败'))).toEqual({ status: 'error', message: 'disk unavailable' });
	});

	it('maps named uTools db failures without depending on their messages', () => {
		const db = new MockDocumentDb();
		setDocumentDb(db);
		const store = createDocumentStore<Note>();
		db.nextPutResult = { ok: false, error: true, name: 'conflict', message: '本地化错误' };

		expect(store.write(note('jianyue/task/1', '冲突'))).toEqual({ status: 'conflict', message: '本地化错误' });

		db.nextPutResult = { ok: false, error: true, name: 'not_found', message: '本地化缺失' };
		expect(store.write(note('jianyue/task/1', '缺失'))).toEqual({ status: 'not-found', message: '本地化缺失' });

		store.write(note('jianyue/task/2', '待删除'));
		db.nextRemoveResult = { ok: false, error: true, name: 'conflict', message: '删除失败' };
		expect(store.remove({ _id: 'jianyue/task/2', _rev: 'rev-1' })).toEqual({ status: 'conflict', message: '删除失败' });
	});

	it('returns an error when native writes or removes cannot read the current document', () => {
		const db = new MockDocumentDb();
		setDocumentDb(db);
		const store = createDocumentStore<Note>();
		db.nextGetError = new Error('read unavailable');

		expect(store.write(note('jianyue/task/1', '写入失败'))).toEqual({ status: 'error', message: 'read unavailable' });

		store.write(note('jianyue/task/2', '待删除'));
		db.nextGetError = new Error('read unavailable');
		expect(store.remove({ _id: 'jianyue/task/2', _rev: 'rev-1' })).toEqual({ status: 'error', message: 'read unavailable' });
	});

	it('deletes a document and reports missing documents', () => {
		const db = new MockDocumentDb();
		setDocumentDb(db);
		const store = createDocumentStore<Note>();
		store.write(note('jianyue/task/1', '待删除'));

		expect(store.remove({ _id: 'jianyue/task/1', _rev: 'rev-1' })).toEqual({ status: 'ok', rev: 'deleted-rev' });
		expect(store.get('jianyue/task/1')).toBeNull();
		expect(store.remove({ _id: 'jianyue/task/missing' })).toEqual({ status: 'not-found' });
	});

	it('rejects stale revisions for native updates and deletes', () => {
		const db = new MockDocumentDb();
		setDocumentDb(db);
		const store = createDocumentStore<Note>();
		store.write(note('jianyue/task/1', '初稿'));

		expect(store.write(note('jianyue/task/1', '错误覆盖', 'rev-expired'))).toEqual({ status: 'conflict' });
		expect(store.remove({ _id: 'jianyue/task/1', _rev: 'rev-expired' })).toEqual({
			status: 'conflict',
			message: 'The supplied _rev does not match the current document.',
		});
		expect(db.get('jianyue/task/1')).toEqual(note('jianyue/task/1', '初稿', 'rev-1'));
	});

	it('keeps per-document results when a bulk write partially fails', () => {
		const db = new MockDocumentDb();
		setDocumentDb(db);
		const store = createDocumentStore<Note>();
		db.nextBulkResults = [
			{ ok: true, rev: 'rev-1' },
			{ ok: false, error: true, message: 'conflict' },
			{ ok: false, error: true, message: 'write failed' },
		];

		expect(store.bulkWrite([
			note('jianyue/task/1', '成功'),
			note('jianyue/task/2', '冲突'),
			note('jianyue/task/3', '失败'),
		])).toEqual([
			{ status: 'ok', rev: 'rev-1' },
			{ status: 'conflict', message: 'conflict' },
			{ status: 'error', message: 'write failed' },
		]);
	});

	it('falls back to in-memory storage without uTools', () => {
		const store = createDocumentStore<Note>();

		expect(store.write(note('jianyue/fallback/1', '离线任务'))).toMatchObject({ status: 'ok' });
		expect(store.get('jianyue/fallback/1')).toMatchObject({ _id: 'jianyue/fallback/1', data: { title: '离线任务' } });
		expect(store.write(note('jianyue/fallback/1', '未带版本的覆盖'))).toEqual({ status: 'conflict', message: 'A current _rev is required to update this document.' });
	});

	it('shares browser fallback documents across store instances', () => {
		const writer = createDocumentStore<Note>();
		const reader = createDocumentStore<Note>();

		expect(writer.write(note('jianyue/fallback/2', '离线任务'))).toMatchObject({ status: 'ok' });
		expect(reader.get('jianyue/fallback/2')).toMatchObject({ _id: 'jianyue/fallback/2', data: { title: '离线任务' } });
	});

	it('isolates in-memory write, get, and list data from caller mutations', () => {
		const store = createDocumentStore<Note>();
		const input: DocumentRecord<Note> = {
			_id: 'jianyue/fallback/3',
			data: { title: '离线任务', metadata: { tags: ['初始'] } },
		};

		expect(store.write(input)).toMatchObject({ status: 'ok' });
		input.data.metadata?.tags.push('输入修改');
		expect(store.get(input._id)?.data.metadata?.tags).toEqual(['初始']);

		const read = store.get(input._id);
		read?.data.metadata?.tags.push('读取修改');
		expect(store.get(input._id)?.data.metadata?.tags).toEqual(['初始']);

		const listed = store.list('jianyue/task/');
		listed[0]?.data.metadata?.tags.push('列表修改');
		expect(store.get(input._id)?.data.metadata?.tags).toEqual(['初始']);
	});

	it('supports in-memory list, remove, and bulk writes with revisions', () => {
		const store = createDocumentStore<Note>();

		expect(store.bulkWrite([
			note('jianyue/bulk/task/1', '第一项'),
			note('jianyue/bulk/template/1', '模板'),
		])).toEqual([
			expect.objectContaining({ status: 'ok' }),
			expect.objectContaining({ status: 'ok' }),
		]);
		const task = store.list('jianyue/bulk/task/')[0];
		if (task === undefined) {
			throw new Error('Expected the bulk-created task to be listed.');
		}
		if (task._rev === undefined) {
			throw new Error('Expected the bulk-created task to have a revision.');
		}
		expect(task).toMatchObject({ _id: 'jianyue/bulk/task/1', data: { title: '第一项' } });
		expect(store.remove({ _id: 'jianyue/bulk/task/1', _rev: task._rev })).toMatchObject({ status: 'ok' });
		expect(store.remove({ _id: 'jianyue/bulk/task/1', _rev: task._rev })).toEqual({ status: 'not-found' });
	});
});
