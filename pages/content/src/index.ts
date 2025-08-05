console.log('content script loaded');
// @ts-ignore
window.nanoGetFrameInfo = (frameId) => {
    return {
        frameId,
        computedHeight: window.innerHeight,
        computedWidth: window.innerWidth,
        href: window.location.href,
        name: window.name,
        title: document.title,
    };
}
