import { describe, expect, it } from 'vitest';
import { understand } from '@/lib/understand';

// How notes read: when a reminder is set (and repeats), what it says, the
// title, and amounts. One line per way people actually write it, in
// English, Bangla and Banglish. NOW is a Wednesday evening.
const NOW = new Date('2026-10-14T19:00:00').getTime();

/** [what was typed, due ("Thu Oct 15 07:00", + " daily" etc.), next step, title, amounts] */
type Row = [string, string | null, string | null, string, string | null];

function row(text: string) {
  const r = understand(text, { now: NOW, currency: 'BDT' });
  const due = r.due ? new Date(r.due).toString().slice(0, 21).replace(/ \d{4}/, '') + (r.repeat ? ` ${r.repeat}` : '') : null;
  const measures = r.measures.map((m) => `${m.metric}:${m.value}${m.unit ?? ''}(${m.label ?? ''})`).join(', ') || null;
  return { due, step: r.nextStep ?? null, title: r.title, measures };
}

describe('reading notes', () => {
  describe('clock times, English', () => {
    it.each<Row>([
      ['remind me at 7', 'Thu Oct 15 07:00', null, 'Reminder', null],
      ['remind me at 7.30', 'Wed Oct 14 19:30', null, 'Reminder', null],
      ['call amma at 7:30pm', 'Wed Oct 14 19:30', 'Call amma', 'Call amma', null],
      ['call amma at 19:30', 'Wed Oct 14 19:30', 'Call amma', 'Call amma', null],
      ['meeting at noon tomorrow', 'Thu Oct 15 12:00', 'Meeting', 'Meeting', null],
      ['remind me at midnight to pay the bill', 'Thu Oct 15 00:00', 'Pay the bill', 'Pay the bill', null],
      ['take medicine tonight', 'Wed Oct 14 21:00', 'Take medicine', 'Take medicine', null],
      ['need to call him this evening', 'Wed Oct 14 19:30', 'Call him', 'Call him', null],
      ['need to wake up at 6 tomorrow morning', 'Thu Oct 15 06:00', 'Wake up', 'Wake up', null],
      ['need to finish it by 5', 'Thu Oct 15 17:00', 'Finish it', 'Finish it', null],
      ['remind me at 9 in the morning', 'Thu Oct 15 09:00', null, 'Reminder', null],
      ['remind me at 8 at night', 'Wed Oct 14 20:00', null, 'Reminder', null],
      ['call the bank at 10am sharp', 'Thu Oct 15 10:00', 'Call the bank', 'Call the bank', null],
      ['remind me at half past 7', 'Wed Oct 14 19:30', null, 'Reminder', null],
      ['remind me at quarter to 8', 'Wed Oct 14 19:45', null, 'Reminder', null],
      ['pick up kids at 3:15', 'Thu Oct 15 15:15', 'Pick up kids', 'Pick up kids', null],
      ['gym at 6am', 'Thu Oct 15 06:00', 'Gym', 'Gym', null],
    ])('%s', (text, due, step, title, measures) => {
      expect(row(text)).toEqual({ due, step, title, measures });
    });
  });

  describe('days', () => {
    it.each<Row>([
      ['dentist on friday at 4pm', 'Fri Oct 16 16:00', 'Dentist', 'Dentist', null],
      ['need to pay rent next monday', 'Mon Oct 19 09:00', 'Pay rent', 'Pay rent', null],
      ['call him on monday', 'Mon Oct 19 09:00', 'Call him', 'Call him', null],
      ['remind me on the 20th', 'Tue Oct 20 09:00', null, 'Reminder', null],
      ['pay the bill on 25 october', 'Sun Oct 25 09:00', 'Pay the bill', 'Pay the bill', null],
      ['submit the form by oct 30', 'Fri Oct 30 09:00', 'Submit the form', 'Submit the form', null],
      ['visit nani on 1st november', 'Sun Nov 01 09:00', 'Visit nani', 'Visit nani', null],
      ['remind me on 5/11', 'Thu Nov 05 09:00', null, 'Reminder', null],
      ['in 2 days call the plumber', 'Fri Oct 16 09:00', 'Call the plumber', 'Call the plumber', null],
      ['remind me in 3 days', 'Sat Oct 17 09:00', null, 'Reminder', null],
      ['remind me next week', 'Wed Oct 21 09:00', null, 'Reminder', null],
      ['remind me the day after tomorrow at 10', 'Fri Oct 16 10:00', null, 'Reminder', null],
      ['remind me this weekend to clean the room', 'Sat Oct 17 09:00', 'Clean the room', 'Clean the room', null],
      ['remind me end of the month to pay rent', 'Sat Oct 31 09:00', 'Pay rent', 'Pay rent', null],
      ['remind me tomorrow', 'Thu Oct 15 09:00', null, 'Reminder', null],
      ['remind me today', 'Wed Oct 14 20:00', null, 'Reminder', null],
      ['remind me tomorrow evening', 'Thu Oct 15 18:00', null, 'Reminder', null],
      ['remind me tomorrow afternoon to call', 'Thu Oct 15 15:00', 'Call', 'Call', null],
    ])('%s', (text, due, step, title, measures) => {
      expect(row(text)).toEqual({ due, step, title, measures });
    });
  });

  describe('relative', () => {
    it.each<Row>([
      ['remind me in 5 minutes', 'Wed Oct 14 19:05', null, 'Reminder', null],
      ['remind me in 90 minutes', 'Wed Oct 14 20:30', null, 'Reminder', null],
      ['remind me in 1.5 hours', 'Wed Oct 14 20:30', null, 'Reminder', null],
      ['remind me in an hour and a half', 'Wed Oct 14 20:30', null, 'Reminder', null],
      ['remind me in 2 hrs', 'Wed Oct 14 21:00', null, 'Reminder', null],
      ['remind me after 30 min', 'Wed Oct 14 19:30', null, 'Reminder', null],
    ])('%s', (text, due, step, title, measures) => {
      expect(row(text)).toEqual({ due, step, title, measures });
    });
  });

  describe('repeats', () => {
    it.each<Row>([
      ['remind me every day at 8 to take medicine', 'Thu Oct 15 08:00 daily', 'Take medicine', 'Take medicine', null],
      ['water the plants every friday', 'Fri Oct 16 09:00 weekly', 'Water the plants', 'Water the plants', null],
      ['pay rent every month on the 1st', 'Sun Nov 01 09:00 monthly', 'Pay rent', 'Pay rent', null],
      ['remind me daily at 9pm', 'Wed Oct 14 21:00 daily', null, 'Reminder', null],
    ])('%s', (text, due, step, title, measures) => {
      expect(row(text)).toEqual({ due, step, title, measures });
    });
  });

  describe('Bangla', () => {
    it.each<Row>([
      ['কাল সকাল ৮টায় মিটিং আছে', 'Thu Oct 15 08:00', 'মিটিং আছে', 'মিটিং আছে', null],
      ['আজ রাত ১০টায় ওষুধ খেতে হবে', 'Wed Oct 14 22:00', 'ওষুধ খেতে হবে', 'ওষুধ খেতে হবে', null],
      ['পরশু বিকেল ৪টায় ডাক্তারের কাছে যেতে হবে', 'Fri Oct 16 16:00', 'ডাক্তারের কাছে যেতে হবে', 'ডাক্তারের কাছে যেতে হবে', null],
      ['শুক্রবার বাজার করতে হবে', 'Fri Oct 16 09:00', 'বাজার করতে হবে', 'বাজার করতে হবে', null],
      ['৩০ মিনিট পরে মনে করিয়ে দিও', 'Wed Oct 14 19:30', null, 'Reminder', null],
      ['১ ঘণ্টা পর ফোন দিতে হবে', 'Wed Oct 14 20:00', 'ফোন দিতে হবে', 'ফোন দিতে হবে', null],
      ['সন্ধ্যা ৭টায় আম্মুকে ফোন দিতে হবে', 'Thu Oct 15 19:00', 'আম্মুকে ফোন দিতে হবে', 'আম্মুকে ফোন দিতে হবে', null],
      ['দুপুর ২টায় খেতে যাবো', 'Thu Oct 15 14:00', 'খেতে যাবো', 'খেতে যাবো', null],
      ['আগামী সোমবার ভাড়া দিতে হবে', 'Mon Oct 19 09:00', 'ভাড়া দিতে হবে', 'ভাড়া দিতে হবে', null],
      ['রাত ৯টা ৩০ এ ঘুমাতে হবে', 'Wed Oct 14 21:30', 'ঘুমাতে হবে', 'ঘুমাতে হবে', null],
      ['সাড়ে ৭টায় উঠতে হবে', 'Wed Oct 14 19:30', 'উঠতে হবে', 'উঠতে হবে', null],
    ])('%s', (text, due, step, title, measures) => {
      expect(row(text)).toEqual({ due, step, title, measures });
    });
  });

  describe('Banglish', () => {
    it.each<Row>([
      ['kal sokal 8 tay meeting', 'Thu Oct 15 08:00', 'Meeting', 'Meeting', null],
      ['aj rat 10 tay oshud khete hobe', 'Wed Oct 14 22:00', 'Oshud khete hobe', 'Oshud khete hobe', null],
      ['porshu bikel 4 tay doctor er kache jete hobe', 'Fri Oct 16 16:00', 'Doctor er kache jete hobe', 'Doctor er kache jete hobe', null],
      ['30 min pore mone koriye dio', 'Wed Oct 14 19:30', null, 'Reminder', null],
      ['1 ghonta por call dite hobe', 'Wed Oct 14 20:00', 'Call dite hobe', 'Call dite hobe', null],
      ['sondhay 7 tay ammu ke phone dite hobe', 'Thu Oct 15 19:00', 'Ammu ke phone dite hobe', 'Ammu ke phone dite hobe', null],
      ['shukrobar bazar korte hobe', 'Fri Oct 16 09:00', 'Bazar korte hobe', 'Bazar korte hobe', null],
    ])('%s', (text, due, step, title, measures) => {
      expect(row(text)).toEqual({ due, step, title, measures });
    });
  });

  describe('must NOT set a reminder (past / facts / not a task)', () => {
    it.each<Row>([
      ['met Rumi at 3pm', null, null, 'Met Rumi at 3pm', null],
      ['the meeting was at 5pm yesterday', null, null, 'The meeting was at 5pm yesterday', null],
      ['I woke up at 6 today', null, null, 'I woke up at 6 today', null],
      ['flight landed at 7:40', null, null, 'Flight landed at 7:40', null],
      ['watched a movie for 2 hours', null, null, 'Watched a movie for 2 hours', null],
      ['the shop opens at 10', null, null, 'The shop opens at 10', null],
      ['lunch was 450 taka at 2pm', null, null, 'Lunch was 450 taka at 2pm', 'spent:450BDT(lunch)'],
      ['called the plumber, he came in 20 minutes', null, null, 'Called the plumber, he came in 20 minutes', null],
    ])('%s', (text, due, step, title, measures) => {
      expect(row(text)).toEqual({ due, step, title, measures });
    });
  });

  describe('amounts', () => {
    it.each<Row>([
      ['rickshaw 50 tk', null, null, 'Rickshaw 50 tk', 'spent:50BDT(rickshaw)'],
      ['cng 120tk', null, null, 'Cng 120tk', 'spent:120BDT(cng)'],
      ['lunch ৳450', null, null, 'Lunch ৳450', 'spent:450BDT(lunch)'],
      ['paid Tk. 1,200 for the bill', null, null, 'Paid Tk. 1,200 for the bill', 'spent:1200BDT(bill)'],
      ['bought rice 2 kg for 180 taka', null, null, 'Bought rice 2 kg for 180 taka', 'spent:180BDT(rice)'],
      ['spent 1.5k on shoes', null, null, 'Spent 1.5k on shoes', 'spent:1500BDT(shoes)'],
      ['got salary 45000', null, null, 'Got salary 45000', 'received:45000BDT(salary)'],
      ['২ হাজার টাকা খরচ হলো বাজারে', null, null, '২ হাজার টাকা খরচ হলো বাজারে', 'spent:2000BDT(বাজারে)'],
      ['বাজার ৫০০ টাকা', null, null, 'বাজার ৫০০ টাকা', 'spent:500BDT(বাজার)'],
      ['dui hajar taka dilam rent', null, null, 'Dui hajar taka dilam rent', 'spent:2000BDT(rent)'],
      ['$12.50 for coffee', null, null, '$12.50 for coffee', 'spent:12.5USD(coffee)'],
      ['spent 20 dollars on a book', null, null, 'Spent 20 dollars on a book', 'spent:20USD(book)'],
      ['50% off at the shop', null, null, '50% off at the shop', null],
      ['room 304, floor 3', null, null, 'Room 304, floor 3', null],
      ['call 01712345678', null, null, 'Call 01712345678', null],
      ['version 2.5 is out', null, null, 'Version 2.5 is out', null],
      ['2-3 days to finish', null, null, '2-3 days to finish', null],
      ['ran 5 km in 30 min', null, null, 'Ran 5 km in 30 min', 'ran:5km()'],
      ['walked 8000 steps', null, null, 'Walked 8000 steps', 'steps:8000steps()'],
      ['slept 7 hours', null, null, 'Slept 7 hours', 'sleep:7h()'],
      ['weight 72 kg today', null, null, 'Weight 72 kg today', 'weight:72kg()'],
      ['read 30 pages', null, null, 'Read 30 pages', 'read:30pages()'],
      ['studied for 2 hours', null, null, 'Studied for 2 hours', 'studied:2h()'],
      ['drank 8 glasses of water', null, null, 'Drank 8 glasses of water', 'water:8glasses(drank)'],
    ])('%s', (text, due, step, title, measures) => {
      expect(row(text)).toEqual({ due, step, title, measures });
    });
  });

  describe('more ways people write it', () => {
    it.each<Row>([
      ['remind me at seven', 'Thu Oct 15 07:00', null, 'Reminder', null],
      ['call amma at seven thirty pm', 'Wed Oct 14 19:30', 'Call amma', 'Call amma', null],
      ['meeting at five pm tomorrow', 'Thu Oct 15 17:00', 'Meeting', 'Meeting', null],
      ['remind me at 12pm', 'Thu Oct 15 12:00', null, 'Reminder', null],
      ['remind me at 12am', 'Thu Oct 15 00:00', null, 'Reminder', null],
      ['remind me at 12', 'Thu Oct 15 12:00', null, 'Reminder', null],
      ['remind me at 1', 'Thu Oct 15 13:00', null, 'Reminder', null],
      ['take pill at 6.45 am', 'Thu Oct 15 06:45', 'Take pill', 'Take pill', null],
      ['dinner 8pm tomorrow', 'Thu Oct 15 20:00', 'Dinner', 'Dinner', null],
      ['tmrw 7pm call the bank', 'Thu Oct 15 19:00', 'Call the bank', 'Call the bank', null],
      ['2moro 9am dentist', 'Thu Oct 15 09:00', 'Dentist', 'Dentist', null],
      ['call him tonite', 'Wed Oct 14 21:00', 'Call him', 'Call him', null],
      ['meet them this eve', 'Wed Oct 14 19:30', 'Meet them', 'Meet them', null],
      ['next fri 6pm football', 'Fri Oct 16 18:00', 'Football', 'Football', null],
      ['fri 5pm meeting', 'Fri Oct 16 17:00', 'Meeting', 'Meeting', null],
      ['on wed submit report', 'Wed Oct 21 09:00', 'Submit report', 'Submit report', null],
      ['dec 25 visit nani', 'Fri Dec 25 09:00', 'Visit nani', 'Visit nani', null],
      ['25th dec visit nani', 'Fri Dec 25 09:00', 'Visit nani', 'Visit nani', null],
      ['remind me on 2026-10-20', 'Tue Oct 20 09:00', null, 'Reminder', null],
      ['pay on 25/12/2026', 'Fri Dec 25 09:00', 'Pay', 'Pay', null],
      ['remind me in a week', 'Wed Oct 21 09:00', null, 'Reminder', null],
      ['remind me in two weeks', 'Wed Oct 28 09:00', null, 'Reminder', null],
      ['remind me a week later', 'Wed Oct 21 09:00', null, 'Reminder', null],
      ['next friday at 6 dinner with Rumi', 'Fri Oct 16 18:00', 'Dinner with Rumi', 'Dinner with Rumi', null],
      ['every monday at 9am standup', 'Mon Oct 19 09:00 weekly', 'Standup', 'Standup', null],
      ['every sunday call home', 'Sun Oct 18 09:00 weekly', 'Call home', 'Call home', null],
      ['between 3 and 5pm meeting', 'Thu Oct 15 15:00', 'Meeting', 'Meeting', null],
      ['3-5pm meeting with client', 'Thu Oct 15 15:00', 'Meeting with client', 'Meeting with client', null],
      ['before 5pm submit the form', 'Thu Oct 15 17:00', 'Submit the form', 'Submit the form', null],
      ['Bought milk. Need to call amma at 7pm. Also the gas bill.', 'Thu Oct 15 19:00', 'Call amma', 'Bought milk', null],
      ['Called amma. Will call her again tomorrow at 9.', 'Thu Oct 15 09:00', 'Call her again', 'Called amma', null],
      ['সাতটায় মিটিং আছে', 'Thu Oct 15 07:00', 'মিটিং আছে', 'মিটিং আছে', null],
      ['কাল সকাল সাতটায় উঠতে হবে', 'Thu Oct 15 07:00', 'উঠতে হবে', 'উঠতে হবে', null],
      ['দুটোয় খেতে যাবো', 'Thu Oct 15 14:00', 'খেতে যাবো', 'খেতে যাবো', null],
      ['সাড়ে আটটায় ক্লাস আছে', 'Wed Oct 14 20:30', 'ক্লাস আছে', 'ক্লাস আছে', null],
      ['আজ সকালে ৮টায় উঠেছি', null, null, 'আজ সকালে ৮টায় উঠেছি', null],
      ['কাল বাজারে গিয়েছিলাম', null, null, 'কাল বাজারে গিয়েছিলাম', null],
      ['kal gechilam bazar e', null, null, 'Kal gechilam bazar e', null],
      ['kal jabo bazar e', 'Thu Oct 15 09:00', 'Jabo bazar', 'Jabo bazar', null],
      ['kal sat tay uthte hobe', 'Thu Oct 15 07:00', 'Uthte hobe', 'Uthte hobe', null],
      ['dui tay meeting ache', 'Thu Oct 15 14:00', 'Meeting ache', 'Meeting ache', null],
      ['aj sokale 8 tay uthlam', null, null, 'Aj sokale 8 tay uthlam', null],
      ['৮:৩০ এ ক্লাস', 'Wed Oct 14 20:30', 'ক্লাস', 'ক্লাস', null],
      ['রাত ১২টায় ঘুমাবো', 'Thu Oct 15 00:00', 'ঘুমাবো', 'ঘুমাবো', null],
      ['রাত ২টায় ঘুম থেকে উঠতে হবে', 'Thu Oct 15 02:00', 'ঘুম থেকে উঠতে হবে', 'ঘুম থেকে উঠতে হবে', null],
      ['sokal 6 tay gym', 'Thu Oct 15 06:00', 'Gym', 'Gym', null],
      ['I have a meeting at 4pm', 'Thu Oct 15 16:00', 'Meeting', 'Meeting', null],
      ['I have to go at 4', 'Thu Oct 15 16:00', 'Go', 'Go', null],
      ['we\'re meeting at 5 tomorrow', 'Thu Oct 15 17:00', 'We\'re meeting', 'We\'re meeting', null],
      ['can you remind me at 6', 'Thu Oct 15 18:00', null, 'Reminder', null],
      ['pls remind me at 6', 'Thu Oct 15 18:00', null, 'Reminder', null],
      ['don\'t forget to pay rent on the 1st', 'Sun Nov 01 09:00', 'Pay rent', 'Pay rent', null],
      ['Remember: call amma at 7.', 'Thu Oct 15 07:00', 'Call amma', 'Call amma', null],
      ['TODO call bank 10am', 'Thu Oct 15 10:00', 'Call bank', 'Call bank', null],
      ['- call bank at 10am', 'Thu Oct 15 10:00', 'Call bank', 'Call bank', null],
      ['- buy milk', null, null, 'Buy milk', null],
      ['- pick up laundry at 6', 'Thu Oct 15 18:00', 'Pick up laundry', 'Pick up laundry', null],
      ['meeting rescheduled to 3pm friday', 'Fri Oct 16 15:00', 'Meeting rescheduled', 'Meeting rescheduled', null],
      ['the class is at 9am every day', 'Thu Oct 15 09:00 daily', 'The class', 'The class', null],
      ['my alarm is at 6', null, null, 'My alarm is at 6', null],
      ['bus leaves at 7 tomorrow', 'Thu Oct 15 07:00', 'Bus leaves', 'Bus leaves', null],
      ['reached home at 11pm', null, null, 'Reached home at 11pm', null],
      ['sent the email at 3', null, null, 'Sent the email at 3', null],
      ['it took 20 minutes', null, null, 'It took 20 minutes', null],
      ['done in 5 minutes', null, null, 'Done in 5 minutes', null],
      ['reply within 2 hours', 'Wed Oct 14 21:00', 'Reply', 'Reply', null],
      ['see you at 8', 'Wed Oct 14 20:00', 'See you', 'See you', null],
    ])('%s', (text, due, step, title, measures) => {
      expect(row(text)).toEqual({ due, step, title, measures });
    });
  });

  // Too vague to pick a time, or needs a clock unit not supported (hourly).
  // Better no reminder than a wrong one.
  it.each(['need to send it this afternoon', 'remind me in a bit', 'call me back in 10', 'remind me every hour', 'after lunch call him'])('no reminder: %s', (text) => {
    expect(understand(text, { now: NOW }).due).toBeUndefined();
  });
});
