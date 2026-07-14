import pkg from '../../package.json';

export function PrivacyNotice() {
  return (
    <div className="mt-8 flex flex-col items-center gap-2 text-center text-xs text-text-dim">
      <span>v{pkg.version}</span>
      <div className="flex items-center gap-3">
        <a className="github-button" href="https://github.com/snokamedia/flickerscope" data-icon="octicon-star" data-size="large" data-show-count="true" aria-label="Star snokamedia/flickerscope on GitHub">Star</a>
        <a className="github-button" href="https://github.com/snokamedia" data-icon="octicon-follow" data-size="large" data-show-count="true" aria-label="Follow @snokamedia on GitHub">Follow @snokamedia</a>
      </div>
    </div>
  );
}
