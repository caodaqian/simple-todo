export interface DocumentRecord<T> {
	_id: string;
	_rev?: string;
	data: T;
}

export interface DocumentReference {
	_id: string;
	_rev?: string;
}

export type DocumentWriteResult =
	| { status: 'ok'; rev?: string }
	| { status: 'not-found'; message?: string }
	| { status: 'conflict'; message?: string }
	| { status: 'error'; message?: string };

const isConflictMessage = (message: string): boolean => message.toLowerCase().includes('conflict');

const isNotFoundMessage = (message: string): boolean => {
	const normalized = message.toLowerCase();
	return normalized.includes('not found') || normalized.includes('missing');
};

const toWriteResult = (result: UtoolsDbResult): DocumentWriteResult => {
	if (result.ok === true && result.error !== true) {
		return result.rev === undefined ? { status: 'ok' } : { status: 'ok', rev: result.rev };
	}

	const message = result.message;
	if (result.name === 'conflict') {
		return message === undefined ? { status: 'conflict' } : { status: 'conflict', message };
	}
	if (result.name === 'not_found') {
		return message === undefined ? { status: 'not-found' } : { status: 'not-found', message };
	}
	if (message !== undefined && isConflictMessage(message)) {
		return { status: 'conflict', message };
	}
	if (message !== undefined && isNotFoundMessage(message)) {
		return { status: 'not-found', message };
	}
	return message === undefined ? { status: 'error' } : { status: 'error', message };
};

const toErrorResult = (error: unknown): DocumentWriteResult => {
	return error instanceof Error ? { status: 'error', message: error.message } : { status: 'error' };
};

const toDocumentRecord = <T>(document: UtoolsDbDocument | null): DocumentRecord<T> | null => {
	if (document === null || typeof document._id !== 'string' || !Object.hasOwn(document, 'data')) {
		return null;
	}

	return {
		_id: document._id,
		...(typeof document._rev === 'string' ? { _rev: document._rev } : {}),
		data: document.data as T,
	};
};

const toUtoolsDocument = <T>(document: DocumentRecord<T>): UtoolsDbDocument => ({
	_id: document._id,
	...(document._rev === undefined ? {} : { _rev: document._rev }),
	data: document.data,
});

const cloneData = <T>(data: T): T => {
	if (typeof structuredClone === 'function') {
		return structuredClone(data);
	}
	return JSON.parse(JSON.stringify(data)) as T;
};

const cloneDocumentRecord = <T>(document: DocumentRecord<T>): DocumentRecord<T> => ({
	_id: document._id,
	...(document._rev === undefined ? {} : { _rev: document._rev }),
	data: cloneData(document.data),
});

export interface DocumentStore<T> {
	get(id: string): DocumentRecord<T> | null;
	list(prefix: string): DocumentRecord<T>[];
	write(document: DocumentRecord<T>): DocumentWriteResult;
	remove(document: DocumentReference): DocumentWriteResult;
	bulkWrite(documents: DocumentRecord<T>[]): DocumentWriteResult[];
}

interface MemoryDocumentDatabase {
	documents: Map<string, DocumentRecord<unknown>>;
	revision: number;
}

const browserFallbackDatabase: MemoryDocumentDatabase = {
	documents: new Map(),
	revision: 0,
};

class UtoolsDocumentStore<T> implements DocumentStore<T> {
	constructor(private readonly db: UtoolsDb) { }

	get(id: string): DocumentRecord<T> | null {
		return toDocumentRecord<T>(this.db.get(id));
	}

	list(prefix: string): DocumentRecord<T>[] {
		const records: DocumentRecord<T>[] = [];
		for (const document of this.db.allDocs(prefix)) {
			const record = toDocumentRecord<T>(document);
			if (record !== null && record._id.startsWith(prefix)) {
				records.push(record);
			}
		}
		return records;
	}

	write(document: DocumentRecord<T>): DocumentWriteResult {
		try {
			const current = this.get(document._id);
			if (current !== null && document._rev === undefined) {
				return { status: 'conflict', message: 'A current _rev is required to update this document.' };
			}
			return toWriteResult(this.db.put(toUtoolsDocument(document)));
		} catch (error: unknown) {
			return toErrorResult(error);
		}
	}

	remove(document: DocumentReference): DocumentWriteResult {
		try {
			const current = this.get(document._id);
			if (current === null) {
				return { status: 'not-found' };
			}
			if (current._rev !== undefined && document._rev === undefined) {
				return { status: 'conflict', message: 'A current _rev is required to delete this document.' };
			}
			if (current._rev !== undefined && document._rev !== current._rev) {
				return { status: 'conflict', message: 'The supplied _rev does not match the current document.' };
			}
			return toWriteResult(this.db.remove({ _id: document._id, ...(document._rev === undefined ? {} : { _rev: document._rev }) }));
		} catch (error: unknown) {
			return toErrorResult(error);
		}
	}

	bulkWrite(documents: DocumentRecord<T>[]): DocumentWriteResult[] {
		try {
			const results = this.db.bulkDocs(documents.map(toUtoolsDocument));
			return documents.map((_, index) => {
				const result = results[index];
				return result === undefined
					? { status: 'error', message: 'uTools db.bulkDocs returned no result for this document.' }
					: toWriteResult(result);
			});
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : undefined;
			return documents.map(() => (message === undefined ? { status: 'error' } : { status: 'error', message }));
		}
	}
}

class MemoryDocumentStore<T> implements DocumentStore<T> {
	constructor(private readonly database: MemoryDocumentDatabase) { }

	get(id: string): DocumentRecord<T> | null {
		const document = this.database.documents.get(id) as DocumentRecord<T> | undefined;
		return document === undefined ? null : cloneDocumentRecord(document);
	}

	list(prefix: string): DocumentRecord<T>[] {
		return [...this.database.documents.values()]
			.map((document) => document as DocumentRecord<T>)
			.filter((document) => document._id.startsWith(prefix))
			.map(cloneDocumentRecord);
	}

	write(document: DocumentRecord<T>): DocumentWriteResult {
		const current = this.database.documents.get(document._id) as DocumentRecord<T> | undefined;
		if (current !== undefined && document._rev === undefined) {
			return { status: 'conflict', message: 'A current _rev is required to update this document.' };
		}
		if (current !== undefined && document._rev !== current._rev) {
			return { status: 'conflict', message: 'The supplied _rev does not match the current document.' };
		}

		this.database.revision += 1;
		const rev = this.database.revision.toString();
		this.database.documents.set(document._id, { ...cloneDocumentRecord(document), _rev: rev });
		return { status: 'ok', rev };
	}

	remove(document: DocumentReference): DocumentWriteResult {
		const current = this.database.documents.get(document._id) as DocumentRecord<T> | undefined;
		if (current === undefined) {
			return { status: 'not-found' };
		}
		if (document._rev === undefined) {
			return { status: 'conflict', message: 'A current _rev is required to delete this document.' };
		}
		if (document._rev !== current._rev) {
			return { status: 'conflict', message: 'The supplied _rev does not match the current document.' };
		}

		this.database.documents.delete(document._id);
		this.database.revision += 1;
		return { status: 'ok', rev: this.database.revision.toString() };
	}

	bulkWrite(documents: DocumentRecord<T>[]): DocumentWriteResult[] {
		return documents.map((document) => this.write(document));
	}
}

export const createDocumentStore = <T>(): DocumentStore<T> => {
	const db = window.utools?.db;
	return db === undefined ? new MemoryDocumentStore<T>(browserFallbackDatabase) : new UtoolsDocumentStore<T>(db);
};