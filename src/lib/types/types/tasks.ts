export type TaskStatus = 'running' | 'paused' | 'completed';
export type WorkStatus = 'working' | 'not_working';
export type WorkMode = 'office' | 'remote';

export interface UserTask {
  id: string;
  user_id: string;
  tender_id: string | null;
  description: string;
  task_status: TaskStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserTaskWithRelations extends UserTask {
  tender: {
    id: string;
    title: string;
  } | null;
  user: {
    id: string;
    full_name: string;
    email: string;
    current_work_mode: WorkMode;
    current_work_status: WorkStatus;
  };
}

export interface TaskFilters {
  userId?: string;
}
