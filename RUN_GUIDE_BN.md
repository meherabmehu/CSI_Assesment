# সহজ বাংলায় চালানোর নিয়ম

## আপনার কম্পিউটারে এখন

### এক ক্লিকে ল্যাপটপে চালু করুন

প্রজেক্ট ফোল্ডারের **START_LOCAL.cmd**-এ double-click করুন। PostgreSQL-এর বর্তমান `.env` ব্যবহার করে অ্যাপ ও local MQTT broker চালু হবে এবং browser খুলবে। আগে থেকেই অ্যাপ চালু থাকলে আবার চালু করবে না। বন্ধ করতে **STOP_LOCAL.cmd**-এ double-click করুন; database-এর তথ্য থাকবে।

এই local mode-এ MQTT সংযোগ আপনার ল্যাপটপের ভেতরেই চলে। Employee ID `08` থাকে। MQTT পরীক্ষা করতে project terminal-এ `npm run simulate:local` চালান। এটি পরীক্ষামূলক COUNT, duplicate ও VOID পাঠিয়ে matching response দেখায়। Demo history আসল local database-এ থাকবে, তবে COUNT-এর পর VOID থাকায় net production বাড়বে না।

চালু হতে সমস্যা হলে PostgreSQL service চালু আছে কি না এবং `.runtime/server-error.log` দেখুন। নতুন কম্পিউটারে প্রথমে Node.js ও PostgreSQL install, `npm ci`, `.env` configure এবং `npm run db:create` করতে হবে।

PostgreSQL সংযুক্ত, `cis_assessment` database তৈরি এবং Employee/Candidate ID `08` সেট করা আছে। Password স্থানীয় `.env`-এ আছে; GitHub-এ নেই।

প্রজেক্টের terminal-এ চালান:

```powershell
npm start
```

তারপর browser-এ যান: **http://127.0.0.1:3000**। বন্ধ করতে terminal-এ Ctrl+C দিন। আগে থেকেই চালু থাকলে দ্বিতীয়বার চালাতে হবে না।

## কীভাবে দেখাবেন

1. **Count +5** চাপুন, তারপর **Submit event**। মোট উৎপাদন ৫ বাড়বে।
2. JSON না বদলে আবার **Submit event**। DUPLICATE দেখাবে; মোট আর বাড়বে না।
3. **Correction** দিয়ে পাঠান। আগের ৫টি বাদ যাবে; ইতিহাস থাকবে।
4. **Batch example** পাঠালে COUNT-এর আগে VOID, duplicate ও ভুল খবরের উদাহরণ একসঙ্গে পাবেন।
5. Pending review থেকে খবর টিক দিয়ে **Acknowledge selected** চাপুন। যাচাইয়ের সংখ্যা কমবে, উৎপাদন বদলাবে না।
6. **Exceptions**-এ সমস্যা এবং **History**-তে সব পাঠানোর চেষ্টা দেখুন।
7. **Device connection**-এ Employee ID `08`, সংযোগ এবং সর্বশেষ challenge/response দেখুন।

## নিজে MQTT পরীক্ষা

সফটওয়্যার চালু রেখে আরেকটি terminal-এ:

```powershell
npm run simulate
```

এটি আপনার `08` topic-এ একটি পরীক্ষামূলক challenge পাঠায়। `DEMO-LINE`-এ ৫ যোগ করে আবার VOID দিয়ে বাদ দেয়, তাই মোট উৎপাদন বাড়ে না। Duplicate ও সংশোধনের ইতিহাস থাকে। DEMO-LINE-এর pending COUNT চাইলে dashboard থেকে ACK করুন। পরীক্ষকের আসল simulator-ও একই topic-এ challenge পাঠাতে পারবেন।

## Tests এবং ZIP

```powershell
npm test
npm run test:browser
npm run package
```

Tests মূল database মুছে না; আলাদা অস্থায়ী database ব্যবহার করে। Screenshot `artifacts` ফোল্ডারে, জমা দেওয়ার source ZIP `artifacts/source.zip`-এ। ZIP তৈরির আগে সব পরিবর্তন Git-এ commit করা থাকতে হবে।

## আপনার যেসব কাজ লাগবে

- পরীক্ষকের দেওয়া Google Form-এ GitHub link, ZIP ও প্রয়োজনীয় screenshot জমা দেবেন। Form-এর URL বা deadline এই PDF-এ দেওয়া নেই।
- তিনটি অস্পষ্ট নিয়মের সিদ্ধান্ত `TECHNICAL_EXPLANATION.md`-এ আছে। পরীক্ষক অন্য নিয়ম চাইলে সেটি জানাবেন।
- AI ব্যবহারের বিবরণ ও প্রাসঙ্গিক কথোপকথনের রেকর্ড রাখা হয়েছে। পরীক্ষক পুরো হুবহু chat export চাইলে এই chat export করে সঙ্গে দেবেন।
- Review-এর আগে `TECHNICAL_EXPLANATION.md` পড়ুন। বিশেষ করে COUNT, VOID, duplicate, transaction এবং একই service কেন HTTP/MQTT দুই জায়গায় ব্যবহৃত হচ্ছে—এসব বোঝাতে হবে।

Backend নিয়ম মেনে কাজ করে, database তথ্য রাখে, frontend ফল দেখায়, MQTT যন্ত্রের খবর আনে—এই চার অংশ মিলে প্রজেক্টটি কাজ করে।
