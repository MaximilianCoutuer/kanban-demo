import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TaskService } from './task.service';

describe('TaskService', () => {
  let service: TaskService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(TaskService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it('uses the task API contract', () => {
    const task = { id: 'a', title: 'Task', status: 'ToDo' as const };
    service.list().subscribe((result) => expect(result).toEqual([task]));
    const list = http.expectOne('/api/tasks');
    expect(list.request.method).toBe('GET');
    list.flush([task]);

    service.create('Task').subscribe((result) => expect(result).toEqual(task));
    const create = http.expectOne('/api/tasks');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({ title: 'Task' });
    create.flush(task, { status: 201, statusText: 'Created' });

    service.complete('a').subscribe((result) => expect(result.status).toBe('Done'));
    const complete = http.expectOne('/api/tasks/a/complete');
    expect(complete.request.method).toBe('POST');
    expect(complete.request.body).toBeNull();
    complete.flush({ ...task, status: 'Done' });

    service.delete('a').subscribe();
    const remove = http.expectOne('/api/tasks/a');
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('deletes the task collection without a request body', () => {
    let completed = false;
    service.deleteAll().subscribe({ complete: () => completed = true });
    const request = http.expectOne('/api/tasks');
    expect(request.request.method).toBe('DELETE');
    expect(request.request.body).toBeNull();
    request.flush(null, { status: 204, statusText: 'No Content' });
    expect(completed).toBe(true);
  });
});
