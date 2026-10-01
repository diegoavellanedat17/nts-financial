// La futura app de Diego puede reutilizar las tablas con VITE_PERSON_TAG=diego.
export const personTag = import.meta.env.VITE_PERSON_TAG?.trim() || 'natalia';
if (!/^[a-z][a-z0-9_]{0,39}$/.test(personTag)) throw new Error('VITE_PERSON_TAG debe ser un identificador como natalia o diego.');
export const personName = personTag === 'natalia' ? 'Natalia' : personTag === 'diego' ? 'Diego' : personTag;
