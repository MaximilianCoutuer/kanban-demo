import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { App } from './app';

describe('task board', () => {
  let fixture: ComponentFixture<App>;
  let http: HttpTestingController;
  let element: HTMLElement;
  const task = { id: 'a', title: 'First task', status: 'ToDo' };
  const done = { id: 'b', title: 'Finished', status: 'Done' };

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
  afterEach(() => http.verify());

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
});
