NODE_BIN=./node_modules/.bin
DIFF_COVER_BASE_BRANCH=master

help:
	@echo '                                                                                     		'
	@echo 'Makefile for the edX ecommerce project.                                              		'
	@echo '                                                                                     		'
	@echo 'Usage:                                                                               		'
	@echo '    make requirements                 install requirements for local development     		'
	@echo '    make migrate                      apply migrations                               		'
	@echo '    make serve                        start the dev server at localhost:8002         		'
	@echo '    make clean                        delete generated byte code and coverage reports		'
	@echo '    make validate_js                  run JavaScript unit tests and linting          		'
	@echo '    make validate_python              run Python unit tests and quality checks       		'
	@echo '    make fast_validate_python         run Python unit tests (in parallel) and quality checks	'
	@echo '    make quality                      run PEP8 and Pylint                            		'
	@echo '    make validate                     Run Python and JavaScript unit tests and linting 		'
	@echo '    make html_coverage                generate and view HTML coverage report         		'
	@echo '    make e2e                          run end to end acceptance tests                		'
	@echo '    make extract_translations         extract strings to be translated               		'
	@echo '    make dummy_translations           generate dummy translations                    		'
	@echo '    make compile_translations         generate translation files                     		'
	@echo '    make fake_translations            install fake translations                      		'
	@echo '    make pull_translations            pull translations from Transifex               		'
	@echo '    make update_translations          install new translations from Transifex        		'
	@echo '    make clean_static                 delete compiled/compressed static assets       		'
	@echo '    make static                       compile and compress static assets               		'
	@echo '    make detect_changed_source_translations    check if translation files are up-to-date		'
	@echo '    make validate_translations        install fake translations and check if translation files are up-to-date'
	@echo '    make production-requirements      install requirements for production                    '
	@echo '                                                                                     		'

requirements.js:
	https://github.com/wpcfan/ecommerce.git
	npm install
	# Allow root for Docker
	$(NODE_BIN)/bower install --allow-root

requirements: requirements.js
	pip install -r e2e/requirements.txt --exists-action w
	pip install -r requirements/local.txt --exists-action w

production-requirements: requirements.js
	pip install -r requirements.txt --exists-action w

migrate:
	python manage.py migrate

serve:
	python manage.py runserver 0.0.0.0:8002

clean:
	find . -name '*.pyc' -delete
	coverage erase
	rm -rf coverage htmlcov

clean_static:
	rm -rf assets/* ecommerce/static/build/*

quality:
	isort --check-only --recursive e2e/ ecommerce/
	pep8 --config=.pep8 ecommerce e2e
	pylint -j 0 --rcfile=pylintrc ecommerce e2e

validate_js:
	rm -rf coverage
	$(NODE_BIN)/gulp test
	$(NODE_BIN)/gulp lint

validate_python: clean quality
	PATH=$$PATH:$(NODE_BIN) REUSE_DB=1 coverage run --branch --source=ecommerce ./manage.py test ecommerce \
	--settings=ecommerce.settings.test --with-ignore-docstrings --logging-level=DEBUG
	coverage report

fast_validate_python: clean quality
	REUSE_DB=1 DISABLE_ACCEPTANCE_TESTS=True ./manage.py test ecommerce \
	--settings=ecommerce.settings.test --processes=4 --with-ignore-docstrings --logging-level=DEBUG

validate: validate_python validate_js

theme_static:
	python manage.py update_assets --skip-collect

static: theme_static
	$(NODE_BIN)/r.js -o build.js
	python manage.py collectstatic --noinput
	python manage.py compress --force

html_coverage:
	coverage html && open htmlcov/index.html

diff_coverage: validate fast_diff_coverage

fast_diff_coverage:
	coverage xml
	diff-cover coverage.xml --compare-branch=$(DIFF_COVER_BASE_BRANCH)

e2e:
	pytest e2e --junitxml=e2e/xunit.xml

extract_translations:
	python manage.py makemessages -l en -v1 -d django --ignore="docs/*" --ignore="src/*" --ignore="i18n/*" --ignore="assets/*" --ignore="node_modules/*" --ignore="ecommerce/static/bower_components/*" --ignore="ecommerce/static/build/*"
	python manage.py makemessages -l en -v1 -d djangojs --ignore="docs/*" --ignore="src/*" --ignore="i18n/*" --ignore="assets/*" --ignore="node_modules/*" --ignore="ecommerce/static/bower_components/*" --ignore="ecommerce/static/build/*"

dummy_translations:
	cd ecommerce && i18n_tool dummy

compile_translations:
	python manage.py compilemessages

fake_translations: extract_translations dummy_translations compile_translations

pull_translations:
	cd ecommerce && tx pull -af --mode reviewed

push_translations:
	cd ecommerce && tx push -s

update_translations: pull_translations fake_translations

# extract_translations should be called before this command can detect changes
detect_changed_source_translations:
	cd ecommerce && i18n_tool changed

validate_translations: fake_translations detect_changed_source_translations

# Targets in a Makefile which do not produce an output file with the same name as the target name
.PHONY: help requirements migrate serve clean validate_python quality validate_js validate html_coverage e2e \
	extract_translations dummy_translations compile_translations fake_translations pull_translations \
	push_translations update_translations fast_validate_python clean_static production-requirements
