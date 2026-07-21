import {
  HTML_NAMESPACE_URI,
  parse,
  parseBytes,
  parseFragment,
  parseStream,
  serialize
} from "@ismail-elkorchi/html-parser";

const document = parse("<p>package</p>");
if (!serialize(document.tree).includes("<p>package</p>")) {
  throw new Error("installed package document parsing failed");
}

const bytes = parseBytes(new TextEncoder().encode("<p>bytes</p>"));
if (!serialize(bytes.tree).includes("<p>bytes</p>")) {
  throw new Error("installed package byte parsing failed");
}

const { tree: fragment } = parseFragment("<b>fragment</b>", {
  namespaceUri: HTML_NAMESPACE_URI,
  localName: "section"
});
if (!serialize(fragment).includes("<b>fragment</b>")) {
  throw new Error("installed package fragment parsing failed");
}

const stream = new ReadableStream({
  start(controller) {
    controller.enqueue(new TextEncoder().encode("<p>stream</p>"));
    controller.close();
  }
});
const streamed = await parseStream(stream);
if (!serialize(streamed.tree).includes("<p>stream</p>")) {
  throw new Error("installed package stream parsing failed");
}
