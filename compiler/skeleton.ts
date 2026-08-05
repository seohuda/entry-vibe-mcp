/**
 * Hardcoded Entry.getStartProject() skeleton (Korean labels).
 *
 * Media `fileurl` values use internal `temp/media/…` markers. {@link prepareExport}
 * in pack.ts rewrites them to playentry.org's hash-folder layout before packing.
 */
export interface EntryProject {
  /** Work title shown in the Entry editor (playentry.org reads this on import). */
  name: string;
  category: string;
  scenes: Array<{ name: string; id: string }>;
  variables: Array<Record<string, unknown>>;
  objects: Array<Record<string, unknown>>;
  expansionBlocks: string[];
  aiUtilizeBlocks: string[];
  hardwareLiteBlocks?: string[];
  /** Classic hardware module names Entry loads via entryModuleLoader. */
  externalModules?: string[];
  externalModulesLite?: string[];
  speed: number;
  messages?: Array<{ id: string; name: string }>;
  functions?: unknown[];
  tables?: unknown[];
  /** Serialized AI learning model (`Entry.aiLearning.toJSON()`). */
  learning?: Record<string, unknown>;
}

const MEDIA_PREFIX = 'temp/media/';

export function createStartProjectSkeleton(): EntryProject {
  return {
    name: '엔트리 프로젝트',
    category: '기타',
    scenes: [
      {
        name: '장면 1',
        id: '7dwq',
      },
    ],
    variables: [
      {
        name: '초시계',
        id: 'brih',
        visible: false,
        value: '0',
        variableType: 'timer',
        x: 134,
        y: -70,
        array: [],
        object: null,
        isCloud: false,
      },
      {
        name: '대답',
        id: '1vu8',
        visible: false,
        value: '0',
        variableType: 'answer',
        x: 150,
        y: -100,
        array: [],
        object: null,
        isCloud: false,
      },
    ],
    objects: [
      {
        id: '7y0y',
        name: '엔트리봇',
        label: {
          ko: '엔트리봇',
          en: 'Entrybot',
        },
        script: [
          [
            {
              type: 'when_run_button_click',
              x: 40,
              y: 50,
            },
            {
              type: 'repeat_basic',
              statements: [[{ type: 'move_direction' }]],
            },
          ],
        ],
        selectedPictureId: 'vx80',
        objectType: 'sprite',
        rotateMethod: 'free',
        scene: '7dwq',
        sprite: {
          sounds: [
            {
              duration: 1.3,
              ext: '.mp3',
              id: '8el5',
              fileurl: `${MEDIA_PREFIX}bark.mp3`,
              name: '강아지 짖는 소리',
              label: {
                ko: '강아지 짖는소리',
                en: "Doggi's Bark",
              },
            },
          ],
          pictures: [
            {
              id: 'vx80',
              fileurl: `${MEDIA_PREFIX}entrybot1.svg`,
              thumbUrl: `${MEDIA_PREFIX}entrybot1.svg`,
              name: '엔트리봇_걷기1',
              imageType: 'svg',
              dimension: {
                width: 144,
                height: 246,
              },
            },
            {
              id: '4t48',
              fileurl: `${MEDIA_PREFIX}entrybot2.svg`,
              thumbUrl: `${MEDIA_PREFIX}entrybot2.svg`,
              name: '엔트리봇_걷기2',
              imageType: 'svg',
              dimension: {
                width: 144,
                height: 246,
              },
            },
          ],
        },
        entity: {
          x: 0,
          y: 0,
          regX: 72,
          regY: 123,
          scaleX: 0.5128205128205128,
          scaleY: 0.5128205128205128,
          rotation: 0,
          direction: 90,
          width: 144,
          height: 246,
          visible: true,
        },
        lock: false,
        active: true,
      },
    ],
    expansionBlocks: [],
    aiUtilizeBlocks: [],
    hardwareLiteBlocks: [],
    externalModules: [],
    externalModulesLite: [],
    speed: 60,
    messages: [],
    functions: [],
    tables: [],
  };
}

/**
 * Media files that must ship in assets/media/ for .ent packing.
 * SVG is the runtime imageType; PNG is used for Entry's required thumb
 * (and a raster sibling under image/) so playentry.org import succeeds.
 */
export const ENTRYBOT_MEDIA_FILES = [
  'entrybot1.svg',
  'entrybot2.svg',
  'entrybot1.png',
  'entrybot2.png',
  'bark.mp3',
] as const;
