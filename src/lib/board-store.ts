import { getClient, type DataClient, type IOperationResult } from '@microsoft/power-apps/data';
import { types, type Project, type Task } from './board';

export type Board = { projects: Project[]; tasks: Task[] };

export interface BoardStore {
  readonly mode: 'dataverse' | 'local';
  load(): Promise<Board>;
  /** Creates or renames a project. New projects get all 13 standard tasks. */
  saveProject(project: Project, isNew: boolean): Promise<void>;
  saveTask(task: Task, isNew: boolean): Promise<void>;
  deleteTask(id: string): Promise<void>;
  /** Tasks are removed by the relationship's cascade delete. */
  deleteProject(id: string): Promise<void>;
}

export function standardTasks(project: string, newId: () => string): Task[] {
  return types.map((type, index) => ({ id: newId(), project, type: index, owner: '', due: '', hours: null, phase: type.phase, status: 0 }));
}

// ---------------------------------------------------------------------------
// Dataverse
// ---------------------------------------------------------------------------

/** Choice columns created by scripts/provision-dataverse.mjs use 100000000 + index. */
const CHOICE_BASE = 100000000;
const PROJECT = ['i8pb_project', 'i8pb_projects'];
const TASK = ['i8pb_task', 'i8pb_tasks'];

type DataSourcesInfo = Parameters<typeof getClient>[0];
type ProjectRow = { i8pb_projectid: string; i8pb_name: string };
type TaskRow = {
  i8pb_taskid: string; _i8pb_project_value: string; i8pb_type: number; i8pb_responsible?: string | null;
  i8pb_due?: string | null; i8pb_hours?: number | null; i8pb_phase: number; i8pb_status: number;
};

// `pac code add-data-source` generates this file; until then the app falls back to the local store.
const generated = import.meta.glob<DataSourcesInfo>(
  ['/.power/**/dataSourcesInfo.ts', '/src/generated/**/dataSourcesInfo.ts'],
  { eager: true, import: 'dataSourcesInfo' },
);

function findSource(info: DataSourcesInfo, names: string[]) {
  return Object.keys(info).find(key => names.includes(key.toLowerCase()) || names.includes(info[key].tableId?.toLowerCase()));
}

function unwrap<T>(result: IOperationResult<T>): T {
  if (!result.success) throw result.error ?? new Error('Dataverse call failed');
  return result.data;
}

class DataverseStore implements BoardStore {
  readonly mode = 'dataverse';
  private readonly client: DataClient;
  private readonly projectSource: string;
  private readonly taskSource: string;

  constructor(info: DataSourcesInfo, projectSource: string, taskSource: string) {
    this.client = getClient(info);
    this.projectSource = projectSource;
    this.taskSource = taskSource;
  }

  private async all<T>(table: string, select: string[], orderBy: string[]) {
    const rows: T[] = [];
    let skipToken: string | undefined;
    do {
      const result = await this.client.retrieveMultipleRecordsAsync<T>(table, { select, orderBy, skipToken });
      rows.push(...unwrap(result));
      skipToken = result.skipToken;
    } while (skipToken);
    return rows;
  }

  async load(): Promise<Board> {
    const [projects, tasks] = await Promise.all([
      this.all<ProjectRow>(this.projectSource, ['i8pb_projectid', 'i8pb_name'], ['createdon asc']),
      this.all<TaskRow>(this.taskSource, ['i8pb_taskid', '_i8pb_project_value', 'i8pb_type', 'i8pb_responsible', 'i8pb_due', 'i8pb_hours', 'i8pb_phase', 'i8pb_status'], ['i8pb_type asc', 'createdon asc']),
    ]);
    return {
      projects: projects.map(p => ({ id: p.i8pb_projectid, name: p.i8pb_name })),
      tasks: tasks.map(t => ({
        id: t.i8pb_taskid,
        project: t._i8pb_project_value,
        type: t.i8pb_type - CHOICE_BASE,
        owner: t.i8pb_responsible ?? '',
        due: t.i8pb_due ?? '',
        hours: t.i8pb_hours ?? null,
        phase: t.i8pb_phase - CHOICE_BASE,
        status: t.i8pb_status - CHOICE_BASE,
      })),
    };
  }

  private taskRecord(t: Task) {
    return {
      i8pb_name: types[t.type].name,
      'i8pb_Project@odata.bind': `/i8pb_projects(${t.project})`,
      i8pb_type: CHOICE_BASE + t.type,
      i8pb_responsible: t.owner.trim(),
      i8pb_due: t.due || null,
      i8pb_hours: t.hours,
      i8pb_phase: CHOICE_BASE + t.phase,
      i8pb_status: CHOICE_BASE + t.status,
    };
  }

  async saveProject(project: Project, isNew: boolean) {
    const name = project.name.trim();
    if (!isNew) {
      unwrap(await this.client.updateRecordAsync(this.projectSource, project.id, { i8pb_name: name }));
      return;
    }
    unwrap(await this.client.createRecordAsync(this.projectSource, { i8pb_projectid: project.id, i8pb_name: name }));
    await Promise.all(standardTasks(project.id, () => crypto.randomUUID()).map(t => this.saveTask(t, true)));
  }

  async saveTask(task: Task, isNew: boolean) {
    const record = this.taskRecord(task);
    unwrap(isNew
      ? await this.client.createRecordAsync(this.taskSource, { i8pb_taskid: task.id, ...record })
      : await this.client.updateRecordAsync(this.taskSource, task.id, record));
  }

  async deleteTask(id: string) {
    unwrap(await this.client.deleteRecordAsync(this.taskSource, id));
  }

  async deleteProject(id: string) {
    unwrap(await this.client.deleteRecordAsync(this.projectSource, id));
  }
}

// ---------------------------------------------------------------------------
// Local fallback (browser storage), for `npm run dev` before Dataverse is connected
// ---------------------------------------------------------------------------

const LOCAL_KEY = 'projekttavlen-board';

class LocalStore implements BoardStore {
  readonly mode = 'local';
  private board: Board = { projects: [], tasks: [] };

  constructor() {
    try {
      const saved = localStorage.getItem(LOCAL_KEY);
      if (saved) this.board = JSON.parse(saved) as Board;
    } catch { /* storage unavailable: start empty */ }
  }

  private persist() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(this.board)); } catch { /* ignore */ }
  }

  async load() {
    return structuredClone(this.board);
  }

  async saveProject(project: Project, isNew: boolean) {
    const name = project.name.trim();
    if (isNew) {
      this.board.projects.push({ id: project.id, name });
      this.board.tasks.push(...standardTasks(project.id, () => crypto.randomUUID()));
    } else {
      this.board.projects = this.board.projects.map(p => p.id === project.id ? { ...p, name } : p);
    }
    this.persist();
  }

  async saveTask(task: Task, isNew: boolean) {
    const t = { ...task, owner: task.owner.trim() };
    this.board.tasks = isNew ? [...this.board.tasks, t] : this.board.tasks.map(x => x.id === t.id ? t : x);
    this.persist();
  }

  async deleteTask(id: string) {
    this.board.tasks = this.board.tasks.filter(t => t.id !== id);
    this.persist();
  }

  async deleteProject(id: string) {
    this.board.projects = this.board.projects.filter(p => p.id !== id);
    this.board.tasks = this.board.tasks.filter(t => t.project !== id);
    this.persist();
  }
}

export function createBoardStore(): BoardStore {
  for (const info of Object.values(generated)) {
    const projectSource = findSource(info, PROJECT);
    const taskSource = findSource(info, TASK);
    if (projectSource && taskSource) return new DataverseStore(info, projectSource, taskSource);
  }
  return new LocalStore();
}
