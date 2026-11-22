import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, ValidatorFn } from '@angular/forms';
import { finalize, Observable } from 'rxjs';
import { Task, TaskService, TaskStatus } from './task.service';

const titleValidator: ValidatorFn = (control): ValidationErrors | null => {
  const title = (control.value as string).trim();
  return title.length >= 1 && title.length <= 200 ? null : { title: true };
};

@Component({
  selector: 'app-root',
  imports: [ReactiveFormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly api = inject(TaskService);
  protected readonly title = new FormControl('', { nonNullable: true, validators: [titleValidator] });
  protected readonly form = new FormGroup({ title: this.title });
  protected readonly tasks = signal<Task[]>([]);
  protected readonly loading = signal(false);
  protected readonly loadFailed = signal(false);
  protected readonly creating = signal(false);
  protected readonly pending = signal<Set<string>>(new Set());
  protected readonly message = signal('');
  protected readonly titleError = signal('');
  private readonly reconcileNeeded = signal(false);
  protected readonly unavailable = computed(
    () => this.loading() || this.loadFailed() || this.reconcileNeeded(),
  );
  protected readonly columns: { status: TaskStatus; label: string }[] = [
    { status: 'ToDo', label: 'To Do' },
    { status: 'InProgress', label: 'In Progress' },
    { status: 'Done', label: 'Done' },
  ];

  constructor() {
    this.load();
  }

  protected load(): void {
    if (this.loading()) return;
    this.loading.set(true);
    this.loadFailed.set(false);
    this.api.list().pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (tasks) => this.tasks.set(tasks),
      error: () => this.loadFailed.set(true),
    });
  }

  protected add(): void {
    if (this.creating() || this.unavailable()) return;
    this.title.markAsTouched();
    this.titleError.set('');
    if (this.title.invalid) return;
    const title = this.title.value.trim();
    this.creating.set(true);
    this.message.set('');
    this.api.create(title).pipe(finalize(() => {
      this.creating.set(false);
      this.reconcileIfReady();
    })).subscribe({
      next: (task) => {
        this.tasks.update((tasks) => [...tasks, task].sort((a, b) => a.id.localeCompare(b.id)));
        this.title.reset();
      },
      error: (error: HttpErrorResponse) => {
        const errors = error.error?.errors?.title;
        if (error.status === 400 && Array.isArray(errors) && errors.length) {
          this.titleError.set(errors.join(' '));
        } else {
          this.message.set('Could not add the task. Please try again.');
        }
      },
    });
  }

  protected complete(task: Task): void {
    if (task.status === 'Done' || this.isPending(task.id) || this.unavailable()) return;
    this.mutate(task, 'complete');
  }

  protected remove(task: Task): void {
    if (this.isPending(task.id) || this.unavailable()) return;
    this.mutate(task, 'delete');
  }

  protected isPending(id: string): boolean {
    return this.pending().has(id);
  }

  protected tasksFor(status: TaskStatus): Task[] {
    return this.tasks().filter((task) => task.status === status);
  }

  private mutate(task: Task, action: 'complete' | 'delete'): void {
    this.pending.update((ids) => new Set(ids).add(task.id));
    this.message.set('');
    const request: Observable<Task | void> = action === 'complete'
      ? this.api.complete(task.id) : this.api.delete(task.id);
    request.pipe(finalize(() => {
      this.pending.update((ids) => {
        const next = new Set(ids);
        next.delete(task.id);
        return next;
      });
      this.reconcileIfReady();
    })).subscribe({
      next: (updated) => {
        if (updated) {
          this.tasks.update((tasks) => tasks.map((item) => item.id === task.id ? updated : item));
        } else {
          this.tasks.update((tasks) => tasks.filter((item) => item.id !== task.id));
        }
      },
      error: (error: HttpErrorResponse) => {
        if (error.status === 404) {
          this.message.set('This task no longer exists; the board may have changed.');
          this.reconcileNeeded.set(true);
        } else {
          this.message.set(`Could not ${action} the task. Please try again.`);
        }
      },
    });
  }

  private reconcileIfReady(): void {
    if (this.reconcileNeeded() && !this.creating() && this.pending().size === 0) {
      this.reconcileNeeded.set(false);
      this.load();
    }
  }
}
