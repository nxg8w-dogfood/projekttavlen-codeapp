export const phases = ['Tilbudsfase', 'PFA-fase', 'Prototype / indkøring'];
export const statuses = ['Opgave', 'I gang', 'Pause', 'Done'];
export const types = [
  {name:'Teknisk gennemgang', color:'#6da7a4', phase:0},
  {name:'BOM tilgængelighed', color:'#839dab', phase:0},
  {name:'Kalkulation', color:'#d4af16', phase:0},
  {name:'Quoting', color:'#b081a0', phase:0},
  {name:'Stykliste', color:'#d4af16', phase:1},
  {name:'Stencil / panel', color:'#93ab35', phase:1},
  {name:'Instruktioner', color:'#259dcc', phase:1},
  {name:'SMD program', color:'#d15144', phase:1},
  {name:'Selectiv program', color:'#dd902b', phase:1},
  {name:'Kick off', color:'#d4af16', phase:2},
  {name:'Debug SMD', color:'#93ab35', phase:2},
  {name:'Debug HMT', color:'#259dcc', phase:2},
  {name:'Debug rapport', color:'#dd902b', phase:2},
];
export type Project = {id:string; name:string};
export type Task = {id:string; project:string; type:number; owner:string; due:string; hours:number|null; phase:number; status:number};
