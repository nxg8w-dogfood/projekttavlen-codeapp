import type {Project, Task} from './board';
export const ownerKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLocaleLowerCase('da-DK');
export function ownerOptions(tasks: Task[]) {
  const names = new Map<string,string>();
  for (const task of tasks) {
    const key = ownerKey(task.owner);
    if (key && !names.has(key)) names.set(key, task.owner.trim().replace(/\s+/g, ' '));
  }
  return Array.from(names, ([value,label]) => ({value,label})).sort((a,b)=>a.label.localeCompare(b.label,'da-DK'));
}
export function filterProjectsByOwner(projects: Project[], tasks: Task[], owner: string, phase: number = -1) {
  if (!owner && phase < 0) return projects;
  const ids = new Set(tasks.filter(t=>(!owner || ownerKey(t.owner)===ownerKey(owner)) && (phase < 0 || t.phase===phase)).map(t=>t.project));
  return projects.filter(p=>ids.has(p.id));
}

export function summarizeByOwner(projects: Project[], tasks: Task[], owner: string, phase: number = -1) {
  const selected = tasks.filter(t=>(!owner || ownerKey(t.owner)===ownerKey(owner)) && (phase < 0 || t.phase===phase));
  const selectedProjects = new Set(selected.map(t=>t.project));
  return {
    projects: !owner && phase < 0 ? projects.length : projects.filter(p=>selectedProjects.has(p.id)).length,
    tasks: selected.length,
    inProgress: selected.filter(t=>t.status===1).length,
    completed: selected.filter(t=>t.status===3).length,
    hours: selected.filter(t=>t.status!==3).reduce((sum,t)=>sum+(t.hours??0),0),
  };
}
