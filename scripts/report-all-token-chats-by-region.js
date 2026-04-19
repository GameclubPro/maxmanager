#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const { Bot } = require('@maxhub/max-bot-api');

const DEFAULTS = {
  envFile: '.env',
  outputDir: 'data',
  outputPrefix: 'all_token_chats_by_region_live',
  pauseMs: 60,
  pageSize: 100,
  chatType: 'chat',
};

function term(pattern) {
  return `(^|[^\\p{L}\\p{N}])(?:${pattern})(?=$|[^\\p{L}\\p{N}])`;
}

function makeRegex(pattern) {
  return new RegExp(term(pattern), 'iu');
}

function makeLooseRegex(pattern) {
  return new RegExp(pattern, 'iu');
}

const REGION_RULES = [
  {
    region: 'Краснодарский край',
    subjectType: 'край',
    include: [
      makeRegex('краснодарск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край'),
      makeRegex('краснодар(?!ск)(?:[а-яё-]+)?'),
      makeRegex('кубан(?:ь|и|ью|е|ям|ями|ях)?'),
      makeRegex('новороссийск(?:[а-яё-]+)?'),
      makeRegex('сочи|сочинск(?:[а-яё-]+)?'),
      makeRegex('анап(?:а|е|ы|ой|у)?'),
      makeRegex('геленджик(?:[а-яё-]+)?'),
      makeRegex('армавир(?:[а-яё-]+)?'),
      makeRegex('туапсе(?:[а-яё-]+)?'),
      makeRegex('ейск(?:[а-яё-]+)?'),
      makeRegex('ейски(?:й|м|х)?\\s*район'),
      makeRegex('тимаш[её]вск(?:[а-яё-]+)?'),
      makeRegex('кропоткин(?:[а-яё-]+)?'),
      makeRegex('славянск(?:[а-яё-]+)?'),
      makeRegex('красноармейск(?:[а-яё-]+)?'),
      makeRegex('белореченск(?:[а-яё-]+)?'),
      makeRegex('крымск(?:[а-яё-]+)?'),
      makeRegex('усть-?лабинск(?:[а-яё-]+)?'),
      makeRegex('лабинск(?:[а-яё-]+)?'),
      makeRegex('кореновск(?:[а-яё-]+)?'),
      makeRegex('новокубанск(?:[а-яё-]+)?'),
      makeRegex('щербинов(?:[а-яё-]+)?'),
      makeRegex('старощербинов(?:[а-яё-]+)?'),
      makeRegex('староминск(?:[а-яё-]+)?'),
      makeRegex('гулькевич(?:[а-яё-]+)?'),
      makeRegex('темрюк(?:[а-яё-]+)?'),
      makeRegex('горячий\\s*ключ'),
      makeRegex('курганинск(?:[а-яё-]+)?'),
      makeRegex('лазаревск(?:[а-яё-]+)?'),
      makeRegex('адлер(?:[а-яё-]+)?'),
      makeRegex('сириус(?:[а-яё-]+)?'),
    ],
    exclude: [
      makeRegex('красноярск(?:ий|ого|ому|ом|им|ая|ой|ую)?'),
      makeRegex('крым(?:ск(?:ий|ого|ому|ом|им)?\\s+полуостров|а)'),
    ],
  },
  {
    region: 'Ставропольский край',
    subjectType: 'край',
    include: [
      makeRegex('ставропольск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край'),
      makeRegex('ставропол(?:ь|я|е|ем|ю)'),
      makeRegex('изобильненск(?:[а-яё-]+)?'),
      makeRegex('пятигорск(?:[а-яё-]+)?'),
      makeRegex('ессентук(?:и|ах|ами)?'),
      makeRegex('кисловодск(?:[а-яё-]+)?'),
      makeRegex('минеральн(?:ые\\s+воды|ых\\s+вод)'),
      makeRegex('невинномысск(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Забайкальский край',
    subjectType: 'край',
    include: [
      makeRegex('забайкальск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край'),
      makeRegex('забайкальск(?:ий|ого|ому|ом|им)?\\s*кра(?:й|я|е)'),
      makeRegex('забайкалье'),
      makeRegex('заб\\.\\s*кра(?:й|я)'),
      makeRegex('заб\\.?\\s*,?\\s*край'),
      makeRegex('чит(?:а|е|ы|у|ой|инск(?:[а-яё-]+)?)'),
      makeRegex('75\\s*(?:rus|r|регион)'),
      makeRegex('регион\\s*75'),
      makeRegex('краснокаменск(?:[а-яё-]+)?'),
      makeRegex('борзя'),
      makeRegex('бале(?:й|я|е)?'),
      makeRegex('оловянн(?:ая|ой|ую)?'),
    ],
  },
  {
    region: 'Красноярский край',
    subjectType: 'край',
    include: [
      makeRegex('красноярск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край'),
      makeRegex('красноярск(?:[а-яё-]+)?'),
      makeRegex('24\\s*регион'),
      makeRegex('железногорск(?:[а-яё-]+)?'),
      makeRegex('енисейск(?:[а-яё-]+)?'),
      makeRegex('иланск(?:[а-яё-]+)?'),
      makeRegex('ингаш'),
      makeRegex('курагин(?:о|о\\w*)'),
    ],
    exclude: [
      makeRegex('краснодарск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край'),
      makeRegex('краснодар(?!ск)(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Хабаровский край',
    subjectType: 'край',
    include: [
      makeRegex('хабаровск(?:ий|ого|ому|ом|им)?\\s*край'),
      makeRegex('хабаровск(?:[а-яё-]+)?'),
      makeRegex('27\\s*хабаровск'),
      makeRegex('27\\s*регион'),
    ],
  },
  {
    region: 'Алтайский край',
    subjectType: 'край',
    include: [
      makeRegex('алтайск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край'),
      makeRegex('барнаул(?:[а-яё-]+)?'),
      makeRegex('заринск(?:[а-яё-]+)?'),
      makeRegex('рубцовск(?:[а-яё-]+)?'),
      makeRegex('бийск(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Ростовская область',
    subjectType: 'область',
    include: [
      makeRegex('ростовск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?'),
      makeRegex('ростов-?на-?дону'),
      makeRegex('ростов\\s+на\\s+дону'),
      makeRegex('ростов(?:[а-яё-]+)?'),
      makeRegex('таганрог(?:[а-яё-]+)?'),
      makeRegex('новошахтинск(?:[а-яё-]+)?'),
      makeRegex('родионовк(?:а|и|е|ой|у)?'),
      makeRegex('волгодонск(?:[а-яё-]+)?'),
      makeRegex('каменск(?:[а-яё-]+)?'),
      makeRegex('семикаракорск(?:[а-яё-]+)?'),
      makeRegex('миллеров(?:о|а|е|у)?'),
      makeRegex('матвеев[о-]?курган(?:[а-яё-]+)?'),
      makeRegex('азов(?:[а-яё-]+)?'),
      makeRegex('чалтыр(?:ь|я|е|ю)'),
      makeRegex('зимовк(?:и|ах|ами)?'),
      makeRegex('шахт(?:ы|ах|ами)?'),
    ],
  },
  {
    region: 'Иркутская область',
    subjectType: 'область',
    include: [
      makeRegex('иркутск(?:ая|ой)?\\s*обл(?:асть|\\.)?'),
      makeRegex('иркутск(?:[а-яё-]+)?'),
      makeRegex('ангарск(?:[а-яё-]+)?'),
      makeRegex('нижнеудинск(?:[а-яё-]+)?'),
      makeRegex('хомутов(?:о|а|е|у)?'),
      makeRegex('38\\s*регион'),
      makeRegex('куйбышевск(?:ий|ого|ому|ом|им)?\\s*район'),
      makeRegex('жилкино'),
      makeRegex('ленинск(?:ий|ого|ому|ом|им)?\\s*район'),
    ],
  },
  {
    region: 'Волгоградская область',
    subjectType: 'область',
    include: [
      makeRegex('волгоградск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?'),
      makeRegex('волгоград(?:[а-яё-]+)?'),
      makeRegex('волжск(?:ий|ого|ому|ом|им)'),
      makeRegex('камышин(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Астраханская область',
    subjectType: 'область',
    include: [
      makeRegex('астраханск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?'),
      makeRegex('астраханск(?:ий|ого|ому|ом|им)?\\s*край'),
      makeRegex('астрахан(?:ь|и|ью)?'),
      makeRegex('30\\s*регион'),
    ],
  },
  {
    region: 'Саратовская область',
    subjectType: 'область',
    include: [
      makeRegex('саратовск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?'),
      makeRegex('саратов(?:[а-яё-]+)?'),
      makeRegex('энгельс(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Воронежская область',
    subjectType: 'область',
    include: [
      makeRegex('воронежск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?'),
      makeRegex('воронеж(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Свердловская область',
    subjectType: 'область',
    include: [
      makeRegex('свердловск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?'),
      makeRegex('екатеринбург(?:[а-яё-]+)?'),
      makeRegex('верх-?исетск(?:ий|ого|ому|ом|им)?\\s*район'),
    ],
  },
  {
    region: 'Тюменская область',
    subjectType: 'область',
    include: [
      makeRegex('тюменск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?'),
      makeRegex('тюмень'),
    ],
  },
  {
    region: 'Новосибирская область',
    subjectType: 'область',
    include: [
      makeRegex('новосибирск(?:ая|ой)?\\s*обл(?:асть|\\.)?'),
      makeRegex('новосибирск(?:[а-яё-]+)?'),
      makeRegex('искитим(?:[а-яё-]+)?'),
      makeRegex('\\bнсо\\b'),
      makeRegex('\\bnsk\\b'),
    ],
  },
  {
    region: 'Самарская область',
    subjectType: 'область',
    include: [
      makeRegex('самарск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?'),
      makeRegex('самара'),
      makeRegex('тольятти'),
      makeRegex('пестравк(?:а|и|е|ой|у)?'),
      makeRegex('безенчук(?:[а-яё-]+)?'),
      makeRegex('63\\s*регион'),
    ],
  },
  {
    region: 'Омская область',
    subjectType: 'область',
    include: [
      makeRegex('омск(?:ая|ой)?\\s*обл(?:асть|\\.)?'),
      makeRegex('омск(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Сахалинская область',
    subjectType: 'область',
    include: [
      makeRegex('сахалинск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?'),
      makeRegex('сахалин(?:[а-яё-]+)?'),
      makeRegex('южно-?сахалинск(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Оренбургская область',
    subjectType: 'область',
    include: [
      makeRegex('оренбургск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?'),
      makeRegex('оренбург(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Ульяновская область',
    subjectType: 'область',
    include: [
      makeRegex('ульяновск(?:ая|ой)?\\s*обл(?:асть|\\.)?'),
      makeRegex('ульяновск(?:[а-яё-]+)?'),
      makeRegex('улья\\s*обл'),
    ],
  },
  {
    region: 'Республика Бурятия',
    subjectType: 'республика',
    include: [
      makeRegex('республик(?:а|е|у)?\\s*бурят(?:ия|ии|ию|ией)'),
      makeRegex('бурят(?:ия|ии|ию|ией)'),
      makeRegex('улан-?удэ'),
      makeRegex('\\b03\\b'),
    ],
  },
  {
    region: 'Республика Башкортостан',
    subjectType: 'республика',
    include: [
      makeRegex('республик(?:а|е|у)?\\s*башкортостан'),
      makeRegex('башкортостан(?:[а-яё-]+)?'),
      makeRegex('башкир(?:ия|ии|ию|ией)?'),
      makeRegex('\\bрб\\b'),
      makeRegex('уфа(?:[а-яё-]+)?'),
      makeRegex('уфимск(?:ий|ого|ому|ом|им)?'),
      makeRegex('давлеканов(?:о|а|е|у)?'),
      makeRegex('благоварск(?:ий|ого|ому|ом|им)?'),
      makeRegex('благовещенк(?:[а-яё-]+)?'),
      makeRegex('нагаево'),
      makeRegex('иглино'),
      makeRegex('зубово'),
      makeRegex('чесноковк(?:а|и|е|ой|у)?'),
      makeRegex('булгаков(?:о|а|е|у)?'),
      makeRegex('затон'),
    ],
  },
  {
    region: 'Республика Татарстан',
    subjectType: 'республика',
    include: [
      makeRegex('республик(?:а|е|у)?\\s*татарстан'),
      makeRegex('татарстан(?:[а-яё-]+)?'),
      makeRegex('\\bрт\\b'),
      makeRegex('казан(?:ь|и|ью)?'),
      makeRegex('челн(?:ы|ов|ами)?'),
      makeRegex('зеленодольск(?:[а-яё-]+)?'),
      makeRegex('васильево'),
      makeRegex('солнечный\\s*город\\s*казань'),
    ],
  },
  {
    region: 'Республика Саха (Якутия)',
    subjectType: 'республика',
    include: [
      makeRegex('республик(?:а|е|у)?\\s*саха'),
      makeRegex('якут(?:ия|ии|ию|ией)'),
      makeRegex('якутск(?:[а-яё-]+)?'),
      makeRegex('рс\\s*\\(?я\\)?'),
      makeRegex('алдан(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Республика Хакасия',
    subjectType: 'республика',
    include: [
      makeRegex('республик(?:а|е|у)?\\s*хакаси(?:я|и|ю|ей)'),
      makeRegex('хакаси(?:я|и|ю|ей)'),
      makeRegex('абакан(?:[а-яё-]+)?'),
      makeRegex('минусинск(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Республика Тыва',
    subjectType: 'республика',
    include: [
      makeRegex('республик(?:а|е|у)?\\s*тыв(?:а|е|у|ой)'),
      makeRegex('тыв(?:а|е|у|ой)'),
      makeRegex('чадаан(?:а|е|у)?'),
      makeRegex('чөөн-?хемчик'),
    ],
  },
  {
    region: 'Приморский край',
    subjectType: 'край',
    include: [
      makeRegex('приморск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край'),
      makeRegex('владивосток(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Ямало-Ненецкий автономный округ',
    subjectType: 'автономный округ',
    include: [
      makeRegex('ямало-?ненецк(?:ий|ого|ому|ом|им)?\\s*авт(?:ономный)?\\s*округ'),
      makeRegex('ямал(?:о)?'),
      makeRegex('\\b89\\b'),
    ],
  },
  {
    region: 'Ханты-Мансийский автономный округ',
    subjectType: 'автономный округ',
    include: [
      makeRegex('ханты-?мансийск(?:ий|ого|ому|ом|им)?\\s*авт(?:ономный)?\\s*округ'),
      makeRegex('нефтеюганск(?:[а-яё-]+)?'),
      makeRegex('\\b86\\b'),
    ],
  },
  {
    region: 'Луганская Народная Республика',
    subjectType: 'народная республика',
    include: [
      makeRegex('\\bлнр\\b'),
      makeRegex('луганск(?:[а-яё-]+)?'),
    ],
  },
  {
    region: 'Донецкая Народная Республика',
    subjectType: 'народная республика',
    include: [
      makeRegex('\\bднр\\b'),
      makeRegex('донецк(?:[а-яё-]+)?'),
      makeRegex('мариупол(?:ь|я|е|ем|ю)'),
      makeRegex('бердянск(?:[а-яё-]+)?'),
    ],
  },
];

const GENERIC_REGION_PATTERNS = [
  { region: 'Краснодарский край', subjectType: 'край', regex: makeLooseRegex('краснодарск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край') },
  { region: 'Ставропольский край', subjectType: 'край', regex: makeLooseRegex('ставропольск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край') },
  { region: 'Забайкальский край', subjectType: 'край', regex: makeLooseRegex('забайкальск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край') },
  { region: 'Красноярский край', subjectType: 'край', regex: makeLooseRegex('красноярск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край') },
  { region: 'Хабаровский край', subjectType: 'край', regex: makeLooseRegex('хабаровск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край') },
  { region: 'Алтайский край', subjectType: 'край', regex: makeLooseRegex('алтайск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край') },
  { region: 'Ростовская область', subjectType: 'область', regex: makeLooseRegex('ростовск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?') },
  { region: 'Иркутская область', subjectType: 'область', regex: makeLooseRegex('иркутск(?:ая|ой)?\\s*обл(?:асть|\\.)?') },
  { region: 'Волгоградская область', subjectType: 'область', regex: makeLooseRegex('волгоградск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?') },
  { region: 'Астраханская область', subjectType: 'область', regex: makeLooseRegex('астраханск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?') },
  { region: 'Саратовская область', subjectType: 'область', regex: makeLooseRegex('саратовск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?') },
  { region: 'Воронежская область', subjectType: 'область', regex: makeLooseRegex('воронежск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?') },
  { region: 'Свердловская область', subjectType: 'область', regex: makeLooseRegex('свердловск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?') },
  { region: 'Тюменская область', subjectType: 'область', regex: makeLooseRegex('тюменск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?') },
  { region: 'Новосибирская область', subjectType: 'область', regex: makeLooseRegex('новосибирск(?:ая|ой)?\\s*обл(?:асть|\\.)?') },
  { region: 'Самарская область', subjectType: 'область', regex: makeLooseRegex('самарск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?') },
  { region: 'Омская область', subjectType: 'область', regex: makeLooseRegex('омск(?:ая|ой)?\\s*обл(?:асть|\\.)?') },
  { region: 'Сахалинская область', subjectType: 'область', regex: makeLooseRegex('сахалинск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?') },
  { region: 'Оренбургская область', subjectType: 'область', regex: makeLooseRegex('оренбургск(?:ая|ой|ую|ою)?\\s*обл(?:асть|\\.)?') },
  { region: 'Ульяновская область', subjectType: 'область', regex: makeLooseRegex('ульяновск(?:ая|ой)?\\s*обл(?:асть|\\.)?') },
  { region: 'Республика Башкортостан', subjectType: 'республика', regex: makeLooseRegex('(?:республик(?:а|е|у)?\\s*башкортостан|башкортостан|башкирия)') },
  { region: 'Республика Татарстан', subjectType: 'республика', regex: makeLooseRegex('(?:республик(?:а|е|у)?\\s*татарстан|татарстан)') },
  { region: 'Республика Бурятия', subjectType: 'республика', regex: makeLooseRegex('(?:республик(?:а|е|у)?\\s*бурятия|бурятия)') },
  { region: 'Республика Саха (Якутия)', subjectType: 'республика', regex: makeLooseRegex('(?:республик(?:а|е|у)?\\s*саха|якутия|рс\\s*\\(?я\\)?)') },
  { region: 'Республика Хакасия', subjectType: 'республика', regex: makeLooseRegex('(?:республик(?:а|е|у)?\\s*хакасия|хакасия)') },
  { region: 'Республика Тыва', subjectType: 'республика', regex: makeLooseRegex('(?:республик(?:а|е|у)?\\s*тыва|тыва)') },
  { region: 'Приморский край', subjectType: 'край', regex: makeLooseRegex('приморск(?:ий|ого|ому|ом|им|ая|ой|ую)?\\s*край') },
  { region: 'Ямало-Ненецкий автономный округ', subjectType: 'автономный округ', regex: makeLooseRegex('ямало-?ненецк(?:ий|ого|ому|ом|им)?\\s*авт(?:ономный)?\\s*округ') },
  { region: 'Ханты-Мансийский автономный округ', subjectType: 'автономный округ', regex: makeLooseRegex('ханты-?мансийск(?:ий|ого|ому|ом|им)?\\s*авт(?:ономный)?\\s*округ') },
  { region: 'Луганская Народная Республика', subjectType: 'народная республика', regex: makeLooseRegex('(?:\\bлнр\\b|луганск)') },
  { region: 'Донецкая Народная Республика', subjectType: 'народная республика', regex: makeLooseRegex('(?:\\bднр\\b|донецк|мариуполь|бердянск)') },
];

function printHelp() {
  console.log(`
Usage:
  node scripts/report-all-token-chats-by-region.js

Options:
  --env-file <path>      Env file path (default: .env)
  --output-dir <path>    Output directory (default: data)
  --output-prefix <name> Output filename prefix (default: all_token_chats_by_region_live)
  --pause-ms <n>         Delay between paged API calls (default: 60)
  --page-size <n>        Page size for getAllChats (default: 100)
  --chat-type <type>     Chat type filter (default: chat)
  --help, -h             Show this help
`.trim());
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (!arg.startsWith('--')) {
      throw new Error(`Unknown argument: ${arg}`);
    }

    const eqIndex = arg.indexOf('=');
    const key = eqIndex >= 0 ? arg.slice(0, eqIndex) : arg;
    const inlineValue = eqIndex >= 0 ? arg.slice(eqIndex + 1) : null;
    const { value, nextIndex } = resolveValue(key, inlineValue, argv, index);
    index = nextIndex;

    switch (key) {
      case '--env-file':
        options.envFile = value;
        break;
      case '--output-dir':
        options.outputDir = value;
        break;
      case '--output-prefix':
        options.outputPrefix = value;
        break;
      case '--pause-ms':
        options.pauseMs = parseInteger('pause-ms', value, 0);
        break;
      case '--page-size':
        options.pageSize = parseInteger('page-size', value, 1);
        break;
      case '--chat-type':
        options.chatType = value;
        break;
      default:
        throw new Error(`Unknown argument: ${key}`);
    }
  }

  return options;
}

function resolveValue(key, inlineValue, argv, currentIndex) {
  if (inlineValue !== null) {
    return { value: inlineValue, nextIndex: currentIndex };
  }

  const nextIndex = currentIndex + 1;
  if (nextIndex >= argv.length) {
    throw new Error(`Missing value for ${key}`);
  }

  return { value: argv[nextIndex], nextIndex };
}

function parseInteger(label, value, min) {
  if (!/^-?\d+$/.test(String(value))) {
    throw new Error(`Invalid --${label}: ${value}`);
  }

  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`Invalid --${label}: ${value}`);
  }

  return parsed;
}

function sleep(ms) {
  return ms > 0
    ? new Promise((resolve) => setTimeout(resolve, ms))
    : Promise.resolve();
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}_${hours}${minutes}${seconds}`;
}

function discoverTokenEnvNames(env) {
  return Object.keys(env)
    .filter((name) => /^BOT_TOKEN\d*$/.test(name))
    .filter((name) => String(env[name] || '').trim() !== '')
    .sort((left, right) => {
      if (left === 'BOT_TOKEN') return -1;
      if (right === 'BOT_TOKEN') return 1;
      return left.localeCompare(right, 'en');
    });
}

async function fetchAllChats(api, options) {
  const chats = [];
  let marker = null;
  let pages = 0;

  do {
    const params = marker === null
      ? { count: options.pageSize }
      : { count: options.pageSize, marker };
    const response = await api.getAllChats(params);
    chats.push(...(response.chats || []));
    marker = response.marker ?? null;
    pages += 1;
    await sleep(options.pauseMs);
  } while (marker !== null);

  return { chats, pages };
}

function classifyTitle(title) {
  const matched = [];

  for (const rule of REGION_RULES) {
    const hasInclude = rule.include.some((regex) => regex.test(title));
    if (!hasInclude) {
      continue;
    }

    const hasExclude = Array.isArray(rule.exclude) && rule.exclude.some((regex) => regex.test(title));
    if (hasExclude) {
      continue;
    }

    matched.push({
      region: rule.region,
      subject_type: rule.subjectType,
    });
  }

  if (matched.length === 0) {
    for (const rule of GENERIC_REGION_PATTERNS) {
      if (rule.regex.test(title)) {
        matched.push({
          region: rule.region,
          subject_type: rule.subjectType,
        });
      }
    }
  }

  const uniqueMatches = [];
  const seen = new Set();
  for (const item of matched) {
    const key = `${item.region}|${item.subject_type}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    uniqueMatches.push(item);
  }

  if (uniqueMatches.length === 0) {
    return {
      region: 'Не распределено',
      subject_type: null,
      matched_regions: [],
    };
  }

  if (uniqueMatches.length > 1) {
    return {
      region: 'Несколько регионов',
      subject_type: 'mixed',
      matched_regions: uniqueMatches.map((item) => item.region),
    };
  }

  return {
    region: uniqueMatches[0].region,
    subject_type: uniqueMatches[0].subject_type,
    matched_regions: [uniqueMatches[0].region],
  };
}

function toChatRecord(chat) {
  const title = typeof chat.title === 'string' ? chat.title : '';
  const classification = classifyTitle(title);

  return {
    chat_id: Number(chat.chat_id),
    type: chat.type ?? null,
    status: chat.status ?? null,
    title: title || null,
    participants_count: chat.participants_count ?? null,
    link: chat.link ?? null,
    region: classification.region,
    subject_type: classification.subject_type,
    matched_regions: classification.matched_regions,
  };
}

function sortChats(chats) {
  chats.sort((left, right) => {
    const participantsDelta = (right.participants_count ?? -1) - (left.participants_count ?? -1);
    if (participantsDelta !== 0) return participantsDelta;
    return String(left.title || '').localeCompare(String(right.title || ''), 'ru');
  });
}

async function loadChatsForToken(tokenEnv, token, options) {
  const bot = new Bot(token);
  const botInfo = await bot.api.getMyInfo();
  const { chats, pages } = await fetchAllChats(bot.api, options);
  const visibleChats = chats.filter((chat) => chat.type === options.chatType && chat.status === 'active');

  return {
    token_env: tokenEnv,
    bot: {
      user_id: botInfo.user_id ?? null,
      username: botInfo.username ?? null,
      name: botInfo.name ?? null,
    },
    all_chats_visible_to_bot: chats.length,
    active_target_type_chats: visibleChats.length,
    pages,
    chats: visibleChats,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const envResult = dotenv.config({ path: options.envFile, quiet: true });
  if (envResult.error) {
    throw envResult.error;
  }

  const tokenEnvNames = discoverTokenEnvNames(process.env);
  if (tokenEnvNames.length === 0) {
    throw new Error(`No BOT_TOKEN* variables found in ${options.envFile}`);
  }

  const scanResults = [];
  const uniqueChats = new Map();
  const failedTokens = [];

  for (const tokenEnv of tokenEnvNames) {
    const token = String(process.env[tokenEnv] || '').trim();
    console.log(`[run] Scanning chats via ${tokenEnv}`);

    try {
      const result = await loadChatsForToken(tokenEnv, token, options);
      scanResults.push({
        token_env: result.token_env,
        bot: result.bot,
        all_chats_visible_to_bot: result.all_chats_visible_to_bot,
        active_target_type_chats: result.active_target_type_chats,
        pages: result.pages,
      });

      for (const chat of result.chats) {
        const chatId = Number(chat.chat_id);
        const record = toChatRecord(chat);
        const existing = uniqueChats.get(chatId);

        if (!existing) {
          uniqueChats.set(chatId, {
            ...record,
            visible_via_tokens: [tokenEnv],
          });
          continue;
        }

        if (!existing.visible_via_tokens.includes(tokenEnv)) {
          existing.visible_via_tokens.push(tokenEnv);
        }

        const existingCount = existing.participants_count ?? -1;
        const incomingCount = record.participants_count ?? -1;
        if (incomingCount > existingCount) {
          existing.participants_count = record.participants_count;
        }
        if (!existing.link && record.link) {
          existing.link = record.link;
        }
        if (!existing.title && record.title) {
          existing.title = record.title;
        }
        if (existing.region === 'Не распределено' && record.region !== 'Не распределено') {
          existing.region = record.region;
          existing.subject_type = record.subject_type;
          existing.matched_regions = record.matched_regions;
        } else if (
          existing.region !== record.region &&
          record.region !== 'Не распределено' &&
          existing.region !== 'Несколько регионов'
        ) {
          const mergedRegions = Array.from(new Set([...(existing.matched_regions || []), ...(record.matched_regions || [])]));
          if (mergedRegions.length > 1) {
            existing.region = 'Несколько регионов';
            existing.subject_type = 'mixed';
            existing.matched_regions = mergedRegions;
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedTokens.push({ token_env: tokenEnv, error: message });
      console.error(`[warn] ${tokenEnv} failed: ${message}`);
    }
  }

  const chats = Array.from(uniqueChats.values());
  for (const chat of chats) {
    chat.visible_via_tokens.sort((left, right) => left.localeCompare(right, 'en'));
  }
  sortChats(chats);

  const grouped = new Map();
  for (const chat of chats) {
    if (!grouped.has(chat.region)) {
      grouped.set(chat.region, []);
    }
    grouped.get(chat.region).push(chat);
  }

  const groupedObject = Object.fromEntries(
    Array.from(grouped.entries())
      .sort((left, right) => {
        const countDelta = right[1].length - left[1].length;
        if (countDelta !== 0) return countDelta;
        return left[0].localeCompare(right[0], 'ru');
      })
      .map(([region, regionChats]) => {
        sortChats(regionChats);
        const subjectType = regionChats[0]?.subject_type ?? null;
        return [
          region,
          {
            subject_type: subjectType,
            chats_count: regionChats.length,
            chats: regionChats,
          },
        ];
      }),
  );

  const classifiedChatsCount = chats.filter((chat) => chat.region !== 'Не распределено').length;
  const summaryLines = [];
  summaryLines.push('Актуальный срез чатов по всем токенам');
  summaryLines.push(`Сгенерировано: ${new Date().toISOString()}`);
  summaryLines.push(`Токены: ${tokenEnvNames.join(', ')}`);
  summaryLines.push(`Уникальных чатов: ${chats.length}`);
  summaryLines.push(`Распределено по регионам: ${classifiedChatsCount}`);
  summaryLines.push(`Не распределено: ${chats.length - classifiedChatsCount}`);
  if (failedTokens.length > 0) {
    summaryLines.push(`Ошибки токенов: ${failedTokens.map((item) => `${item.token_env} (${item.error})`).join('; ')}`);
  }
  summaryLines.push('');

  for (const [region, data] of Object.entries(groupedObject)) {
    summaryLines.push(`${region} (${data.chats_count})`);
    for (const chat of data.chats) {
      const countLabel = chat.participants_count === null ? 'n/a' : String(chat.participants_count);
      const matched = chat.matched_regions.length > 1 ? ` | matched=${chat.matched_regions.join(', ')}` : '';
      summaryLines.push(`- ${chat.title || '(без названия)'} | ${chat.chat_id} | users=${countLabel} | tokens=${chat.visible_via_tokens.join(',')}${matched}`);
    }
    summaryLines.push('');
  }

  const payload = {
    ok: failedTokens.length === 0,
    generated_at: new Date().toISOString(),
    env_file: path.resolve(options.envFile),
    token_envs: tokenEnvNames,
    failed_tokens: failedTokens,
    scan_results: scanResults,
    unique_chats_count: chats.length,
    classified_chats_count: classifiedChatsCount,
    unclassified_chats_count: chats.length - classifiedChatsCount,
    grouped_by_region: groupedObject,
  };

  const outputDir = path.resolve(options.outputDir);
  ensureDir(outputDir);
  const timestamp = formatTimestamp();
  const jsonPath = path.join(outputDir, `${options.outputPrefix}_${timestamp}.json`);
  const txtPath = path.join(outputDir, `${options.outputPrefix}_${timestamp}.txt`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(txtPath, `${summaryLines.join('\n')}\n`);

  console.log(`[done] JSON: ${jsonPath}`);
  console.log(`[done] TXT: ${txtPath}`);
}

main().catch((error) => {
  console.error(`[fatal] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
