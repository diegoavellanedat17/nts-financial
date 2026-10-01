export const personTag = import.meta.env.VITE_PERSON_TAG?.trim() || 'natalia';
if (!/^[a-z][a-z0-9_]{0,39}$/.test(personTag)) throw new Error('VITE_PERSON_TAG debe ser un identificador como natalia o diego.');
export const people = [
 { tag: 'natalia', name: 'Natalia', code: '1357955', email: 'natalia-access@nts-financial.example.com' },
 { tag: 'diego', name: 'Diego', code: '123456', email: 'diego-access@nts-financial.example.com' },
];
export const personName = personTag === 'natalia' ? 'Natalia' : personTag === 'diego' ? 'Diego' : personTag;
export function personForEmail(email?: string) { return people.find(p=>p.email===email)?.tag || personTag; }
export function nameForPerson(tag: string) { return people.find(p=>p.tag===tag)?.name || tag; }
