import { MarkdownBlocks } from './markdown-blocks.js';
const renderer = new MarkdownBlocks();
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ id: data.id, blocks: renderer.render(data.text) });
  } catch (error) {
    self.postMessage({ id: data.id, error: error.message });
  }
};
