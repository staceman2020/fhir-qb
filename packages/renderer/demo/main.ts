import { fixtures, type FixtureName } from '@qb/test-fixtures';
import '../src/define.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = $<HTMLElementTagNameMap['qb-questionnaire']>('form');
const select = $<HTMLSelectElement>('fixture');
const width = $<HTMLInputElement>('width');
const widthOut = $<HTMLOutputElement>('width-out');
const output = $<HTMLPreElement>('output');
const status = $<HTMLParagraphElement>('status');

for (const name of Object.keys(fixtures) as FixtureName[])
  select.add(new Option(fixtures[name]().title ?? name, name));

const load = () => {
  form.questionnaire = fixtures[select.value as FixtureName]();
  status.textContent = '';
};
const resize = () => {
  form.parentElement!.style.width = `${width.value}px`;
  widthOut.textContent = `${width.value}px`;
};

select.addEventListener('change', load);
width.addEventListener('input', resize);
$<HTMLInputElement>('protected').addEventListener('change', (e) =>
  (e.target as HTMLInputElement).checked
    ? form.setAttribute('disabled-display', 'protected')
    : form.removeAttribute('disabled-display'),
);
$<HTMLInputElement>('readonly').addEventListener('change', (e) =>
  form.toggleAttribute('readonly', (e.target as HTMLInputElement).checked),
);

const show = (qr: unknown) => (output.textContent = JSON.stringify(qr, null, 2));
form.addEventListener('qb-ready', () => show(form.getQuestionnaireResponse()));
form.addEventListener('qb-change', (e) => show((e as CustomEvent).detail.response));
form.addEventListener('qb-submit', (e) => {
  show((e as CustomEvent).detail.response);
  status.textContent = 'Submitted: status = completed';
});

resize();
load();
