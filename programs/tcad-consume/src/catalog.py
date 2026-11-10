"""Nonexecuting publisher anchor extraction; comments/inert contents excluded."""
from html.parser import HTMLParser
import json
import sys


class CatalogParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.inert = []
        self.anchor = None
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'template', 'noscript'):
            self.inert.append(tag)
        if self.inert:
            return
        if tag == 'a':
            self.anchor = [dict(attrs).get('href'), []]

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if self.inert:
            if tag == self.inert[-1]:
                self.inert.pop()
            return
        if tag == 'a' and self.anchor is not None:
            href, text = self.anchor
            if href:
                self.links.append([href, ''.join(text).strip()])
            self.anchor = None

    def handle_data(self, data):
        if not self.inert and self.anchor is not None:
            self.anchor[1].append(data)


parser = CatalogParser()
parser.feed(sys.stdin.read())
parser.close()
json.dump(parser.links, sys.stdout)
