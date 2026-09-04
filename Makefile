.PHONY: test serve

test:
	sh tests/test-static.sh

serve:
	python3 -m http.server 3000 --directory .
