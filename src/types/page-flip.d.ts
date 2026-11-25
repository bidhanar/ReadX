declare module 'page-flip' {
  export interface FlipSetting {
    startPage: number;
    size: 'fixed' | 'stretch';
    width: number;
    height: number;
    minWidth: number;
    maxWidth: number;
    minHeight: number;
    maxHeight: number;
    drawShadow: boolean;
    flippingTime: number;
    usePortrait: boolean;
    startZIndex: number;
    autoSize: boolean;
    maxShadowOpacity: number;
    showCover: boolean;
    mobileScrollSupport: boolean;
    clickEventForward: boolean;
    useMouseEvents: boolean;
    swipeDistance: number;
    showPageCorners: boolean;
    disableFlipByClick: boolean;
  }
  export interface WidgetEvent {
    data: number | string;
    object: PageFlip;
  }
  export class PageFlip {
    constructor(element: HTMLElement, setting: Partial<FlipSetting>);
    loadFromHTML(items: HTMLElement[] | NodeListOf<HTMLElement>): void;
    updateFromHtml(items: HTMLElement[] | NodeListOf<HTMLElement>): void;
    loadFromImages(urls: string[]): void;
    destroy(): void;
    update(): void;
    clear(): void;
    flipNext(corner?: 'top' | 'bottom'): void;
    flipPrev(corner?: 'top' | 'bottom'): void;
    flip(page: number, corner?: 'top' | 'bottom'): void;
    turnToPage(page: number): void;
    turnToNextPage(): void;
    turnToPrevPage(): void;
    getCurrentPageIndex(): number;
    getPageCount(): number;
    getOrientation(): 'portrait' | 'landscape';
    getSettings(): FlipSetting;
    on(event: 'flip' | 'changeOrientation' | 'changeState' | 'init' | 'update', cb: (e: WidgetEvent) => void): PageFlip;
    off(event: string): void;
  }
}
