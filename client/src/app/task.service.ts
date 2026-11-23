import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';

export type TaskStatus = 'ToDo' | 'InProgress' | 'Done';
export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
}

@Injectable({ providedIn: 'root' })
export class TaskService {
  private readonly http = inject(HttpClient);
  private readonly url = '/api/tasks';

  list() {
    return this.http.get<Task[]>(this.url);
  }

  create(title: string) {
    return this.http.post<Task>(this.url, { title });
  }

  complete(id: string) {
    return this.http.post<Task>(`${this.url}/${encodeURIComponent(id)}/complete`, null);
  }

  delete(id: string) {
    return this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`);
  }

  deleteAll() {
    return this.http.delete<void>(this.url);
  }
}
