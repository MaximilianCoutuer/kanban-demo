import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { App } from './app';

describe('task board', () => {
  let fixture: ComponentFixture<App>;
  let http: HttpTestingController;
  let element: HTMLElement;
  const task = { id: 'a', title: 'First task', status: 'ToDo' as const };
  const done = { id: 'b', title: 'Finished', status: 'Done' as const };

  function render() { fixture.detectChanges(); }
  function button(text: string): HTMLButtonElement {
    const found = [...element.querySelectorAll('button')].find((item) => item.textContent?.trim() === text);
    if (!found) throw new Error(`Missing button ${text}`);
    return found;
  }
  function enter(value: string) {
    const input = element.querySelector('input')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    render();
  }
  function submit() {
    element.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    render();
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(App);
    element = fixture.nativeElement as HTMLElement;
    render();
  });
  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('loads all columns and retries an initial failure', () => {
    expect(element.textContent).toContain('Loading tasks');
    expect(button('Add task').disabled).toBe(true);
    http.expectOne('/api/tasks').flush({}, { status: 500, statusText: 'Error' });
    render();
    expect(element.textContent).toContain('Could not load tasks');
    button('Retry').click();
    render();
    http.expectOne('/api/tasks').flush([task, { id: 'c', title: 'Working', status: 'InProgress' }, done]);
    render();
    const sections = element.querySelectorAll('section');
    expect(sections[0].textContent).toContain('First task');
    expect(sections[1].textContent).toContain('Working');
    expect(sections[2].textContent).toContain('Finished');
    expect(sections[2].querySelectorAll('button')).toHaveLength(1);
  });

  it('validates trimmed UTF-16 length, prevents duplicate creates, and clears only on success', () => {
    http.expectOne('/api/tasks').flush([]);
    render();
    expect(element.textContent).toContain('No tasks yet');
    enter('   ');
    submit();
    expect(element.textContent).toContain('excluding surrounding whitespace');
    enter('😀'.repeat(101));
    submit();
    http.expectNone('/api/tasks');
    enter('  New task  ');
    submit();
    const create = http.expectOne('/api/tasks');
    expect(create.request.body).toEqual({ title: 'New task' });
    expect(button('Adding…').disabled).toBe(true);
    submit();
    http.expectNone('/api/tasks');
    create.flush({}, { status: 500, statusText: 'Error' });
    render();
    expect(element.textContent).toContain('Could not add');
    expect(element.querySelector('input')!.value).toBe('  New task  ');
    submit();
    http.expectOne('/api/tasks').flush({ ...task, title: 'New task' });
    render();
    expect(element.querySelector('input')!.value).toBe('');
    expect(element.textContent).toContain('New task');
  });

  it('shows server validation and keeps the entered title', () => {
    http.expectOne('/api/tasks').flush([]);
    render();
    enter('Title');
    submit();
    http.expectOne('/api/tasks').flush({ errors: { title: ['Title is invalid.'] } }, { status: 400, statusText: 'Bad Request' });
    render();
    expect(element.textContent).toContain('Title is invalid.');
    expect(element.querySelector('input')!.value).toBe('Title');
    expect(element.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
  });

  it('waits for complete and delete success and preserves cards on failure', () => {
    http.expectOne('/api/tasks').flush([task, done]);
    render();
    button('Complete').click();
    render();
    const request = http.expectOne('/api/tasks/a/complete');
    expect(button('Complete').disabled).toBe(true);
    button('Complete').dispatchEvent(new MouseEvent('click'));
    http.expectNone('/api/tasks/a/complete');
    expect(element.querySelector('section')!.textContent).toContain('First task');
    request.flush({}, { status: 500, statusText: 'Error' });
    render();
    expect(element.textContent).toContain('Could not complete');
    expect(button('Complete').disabled).toBe(false);
    button('Complete').click();
    http.expectOne('/api/tasks/a/complete').flush({ ...task, status: 'Done' });
    render();
    expect(element.querySelectorAll('section')[2].textContent).toContain('First task');
    const deleteFirst = element.querySelector<HTMLButtonElement>('[aria-label="Delete First task"]')!;
    deleteFirst.click();
    render();
    expect(deleteFirst.disabled).toBe(true);
    const remove = http.expectOne('/api/tasks/a');
    expect(element.textContent).toContain('First task');
    deleteFirst.dispatchEvent(new MouseEvent('click'));
    http.expectNone('/api/tasks/a');
    remove.flush(null, { status: 204, statusText: 'No Content' });
    render();
    expect(element.textContent).not.toContain('First task');
    expect(element.textContent).toContain('Finished');
  });

  it('reconciles a missing task after outstanding mutations finish, and retries failed refresh', () => {
    http.expectOne('/api/tasks').flush([task, done]);
    render();
    button('Complete').click();
    element.querySelector<HTMLButtonElement>('[aria-label="Delete Finished"]')!.click();
    const complete = http.expectOne('/api/tasks/a/complete');
    const remove = http.expectOne('/api/tasks/b');
    complete.flush({}, { status: 404, statusText: 'Not Found' });
    render();
    expect(element.textContent).toContain('no longer exists');
    expect(element.textContent).toContain('First task');
    http.expectNone('/api/tasks');
    remove.flush(null, { status: 204, statusText: 'No Content' });
    http.expectOne('/api/tasks').flush({}, { status: 500, statusText: 'Error' });
    render();
    expect(element.textContent).toContain('First task');
    expect(element.textContent).toContain('Could not load tasks');
    button('Retry').click();
    http.expectOne('/api/tasks').flush([]);
    render();
    expect(element.textContent).not.toContain('First task');
  });

  it('preserves a card on failed deletion and reconciles a 404 on retry', () => {
    http.expectOne('/api/tasks').flush([done]);
    render();
    button('Delete').click();
    http.expectOne('/api/tasks/b').flush({}, { status: 500, statusText: 'Error' });
    render();
    expect(element.textContent).toContain('Could not delete');
    expect(element.textContent).toContain('Finished');
    expect(button('Delete').disabled).toBe(false);
    button('Delete').click();
    http.expectOne('/api/tasks/b').flush({}, { status: 404, statusText: 'Not Found' });
    render();
    expect(element.textContent).toContain('no longer exists');
    expect(element.textContent).toContain('Finished');
    http.expectOne('/api/tasks').flush([]);
    render();
    expect(element.textContent).not.toContain('Finished');
  });

  it('renders titles as text rather than markup', () => {
    http.expectOne('/api/tasks').flush([{ ...task, title: '<img src=x>' }]);
    render();
    expect(element.textContent).toContain('<img src=x>');
    expect(element.querySelector('img')).toBeNull();
  });

  it('disables bulk deletion while loading, on load failure, and for an empty board', () => {
    const confirm = vi.spyOn(window, 'confirm');
    expect(button('Delete all tasks').disabled).toBe(true);
    fixture.componentInstance['deleteAll']();
    http.expectOne('/api/tasks').flush({}, { status: 500, statusText: 'Error' });
    render();
    expect(button('Delete all tasks').disabled).toBe(true);
    fixture.componentInstance['deleteAll']();
    button('Retry').click();
    http.expectOne('/api/tasks').flush([]);
    render();
    expect(button('Delete all tasks').disabled).toBe(true);
    fixture.componentInstance['deleteAll']();
    expect(confirm).not.toHaveBeenCalled();
    http.expectNone('/api/tasks');
  });

  it('leaves the board, input and alert unchanged when confirmation is canceled', () => {
    http.expectOne('/api/tasks').flush([task]);
    render();
    enter('Draft');
    submit();
    http.expectOne('/api/tasks').flush({}, { status: 500, statusText: 'Error' });
    render();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const bulk = button('Delete all tasks');
    expect(bulk.type).toBe('button');
    expect(bulk.classList.contains('delete')).toBe(true);
    expect(bulk.closest('header')).not.toBeNull();
    expect(bulk.closest('form')).toBeNull();
    bulk.click();
    render();
    expect(confirm).toHaveBeenCalledWith('Delete all tasks in all columns? This affects the shared board and cannot be undone.');
    http.expectNone('/api/tasks');
    expect(element.textContent).toContain('First task');
    expect(element.textContent).toContain('Could not add the task.');
    expect(element.querySelector('input')!.value).toBe('Draft');
  });

  it('keeps cards visible and blocks conflicting operations until bulk deletion succeeds', () => {
    http.expectOne('/api/tasks').flush([task, { id: 'c', title: 'Working', status: 'InProgress' }, done]);
    render();
    enter('Draft');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    button('Delete all tasks').click();
    render();
    const request = http.expectOne('/api/tasks');
    expect(request.request.method).toBe('DELETE');
    expect(button('Deleting all…').disabled).toBe(true);
    expect(element.querySelector('[role="status"]')!.textContent).toContain('Deleting all tasks');
    expect(element.textContent).toContain('First task');
    expect(element.textContent).toContain('Working');
    expect(element.textContent).toContain('Finished');
    expect(button('Add task').disabled).toBe(true);
    expect(button('Complete').disabled).toBe(true);
    expect(element.querySelector<HTMLButtonElement>('[aria-label="Delete Finished"]')!.disabled).toBe(true);
    submit();
    fixture.componentInstance['complete'](task);
    fixture.componentInstance['remove'](done);
    fixture.componentInstance['load']();
    fixture.componentInstance['deleteAll']();
    expect(confirm).toHaveBeenCalledTimes(1);
    http.expectNone('/api/tasks');
    http.expectNone('/api/tasks/a/complete');
    http.expectNone('/api/tasks/b');
    request.flush(null, { status: 204, statusText: 'No Content' });
    render();
    http.expectNone('/api/tasks');
    expect(element.querySelectorAll('.card')).toHaveLength(0);
    expect(element.querySelectorAll('.empty')).toHaveLength(3);
    expect(element.querySelector('input')!.value).toBe('Draft');
    expect(button('Delete all tasks').disabled).toBe(true);
  });

  it('preserves tasks and input on HTTP and network failures and allows retry', () => {
    http.expectOne('/api/tasks').flush([task, done]);
    render();
    enter('Draft');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    button('Delete all tasks').click();
    http.expectOne('/api/tasks').flush({}, { status: 500, statusText: 'Error' });
    render();
    expect(element.querySelector('[role="alert"]')!.textContent).toContain('Could not delete all tasks. Please try again.');
    expect(element.querySelectorAll('.card')).toHaveLength(2);
    expect(element.querySelector('input')!.value).toBe('Draft');
    expect(button('Delete all tasks').disabled).toBe(false);
    button('Delete all tasks').click();
    http.expectOne('/api/tasks').error(new ProgressEvent('error'));
    render();
    expect(element.querySelector('[role="alert"]')!.textContent).toContain('Could not delete all tasks. Please try again.');
    expect(element.querySelectorAll('.card')).toHaveLength(2);
    expect(element.querySelector('input')!.value).toBe('Draft');
    expect(button('Delete all tasks').disabled).toBe(false);
  });

  it('excludes bulk deletion while an individual completion alone is pending', () => {
    http.expectOne('/api/tasks').flush([task, done]);
    render();
    const confirm = vi.spyOn(window, 'confirm');
    expect(button('Delete all tasks').disabled).toBe(false);
    button('Complete').click();
    const complete = http.expectOne('/api/tasks/a/complete');
    render();
    expect(button('Delete all tasks').disabled).toBe(true);
    fixture.componentInstance['deleteAll']();
    expect(confirm).not.toHaveBeenCalled();
    http.expectNone('/api/tasks');
    complete.flush({ ...task, status: 'Done' });
    render();
    expect(button('Delete all tasks').disabled).toBe(false);
  });

  it('excludes bulk deletion while an individual deletion alone is pending', () => {
    http.expectOne('/api/tasks').flush([task, done]);
    render();
    const confirm = vi.spyOn(window, 'confirm');
    expect(button('Delete all tasks').disabled).toBe(false);
    element.querySelector<HTMLButtonElement>('[aria-label="Delete Finished"]')!.click();
    const remove = http.expectOne('/api/tasks/b');
    render();
    expect(button('Delete all tasks').disabled).toBe(true);
    fixture.componentInstance['deleteAll']();
    expect(confirm).not.toHaveBeenCalled();
    http.expectNone('/api/tasks');
    remove.flush(null, { status: 204, statusText: 'No Content' });
    render();
    expect(button('Delete all tasks').disabled).toBe(false);
  });

  it('excludes creation, individual mutations, and pending reconciliation', () => {
    http.expectOne('/api/tasks').flush([task, done]);
    render();
    const confirm = vi.spyOn(window, 'confirm');
    enter('Draft');
    submit();
    const create = http.expectOne('/api/tasks');
    expect(button('Delete all tasks').disabled).toBe(true);
    fixture.componentInstance['deleteAll']();
    create.flush({ id: 'c', title: 'Draft', status: 'ToDo' });
    render();
    button('Complete').click();
    const complete = http.expectOne('/api/tasks/a/complete');
    element.querySelector<HTMLButtonElement>('[aria-label="Delete Finished"]')!.click();
    const remove = http.expectOne('/api/tasks/b');
    render();
    expect(button('Delete all tasks').disabled).toBe(true);
    fixture.componentInstance['deleteAll']();
    complete.flush({}, { status: 404, statusText: 'Not Found' });
    render();
    expect(button('Delete all tasks').disabled).toBe(true);
    fixture.componentInstance['deleteAll']();
    remove.flush(null, { status: 204, statusText: 'No Content' });
    render();
    expect(button('Delete all tasks').disabled).toBe(true);
    fixture.componentInstance['deleteAll']();
    http.expectOne('/api/tasks').flush([task]);
    render();
    expect(button('Delete all tasks').disabled).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
  });
});
