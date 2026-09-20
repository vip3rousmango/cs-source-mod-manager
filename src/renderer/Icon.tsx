export type IconName = 'compass' | 'library' | 'layers' | 'download' | 'activity' | 'news' | 'refresh' | 'external' | 'package' | 'spark'

const paths: Record<IconName, string> = {
  compass: 'M12 2 4.5 19.5 12 16l7.5 3.5L12 2Zm0 5.1 2.1 6.8-2.1 1-2.1-1L12 7.1Z',
  library: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Zm0 0v15M7 6h9M7 10h9',
  layers: 'm12 3 8 4-8 4-8-4 8-4Zm-8 8 8 4 8-4m-16 5 8 4 8-4',
  download: 'M12 3v11m0 0 4-4m-4 4-4-4M4 18v2h16v-2',
  activity: 'M4 13h4l2-7 4 12 2-5h4',
  news: 'M5 4h14a1 1 0 0 1 1 1v14H5a2 2 0 0 1 0-4h15M5 4a2 2 0 0 0 0 4h13M8 12h8m-8 4h6',
  refresh: 'M20 11a8 8 0 0 0-14.8-4L3 9m0-5v5h5m-1 4a8 8 0 0 0 14.8 4L21 15m0 5v-5h-5',
  external: 'M14 4h6v6m-1-5-8 8M17 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5',
  package: 'm12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Zm-8 4.5 8 4.5 8-4.5M12 12v9M8 5.2l8 4.5',
  spark: 'm12 2 1.6 6.4L20 10l-6.4 1.6L12 18l-1.6-6.4L4 10l6.4-1.6L12 2Zm7 14 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z'
}

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg aria-hidden="true" className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>
}
