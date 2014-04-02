from .common import *

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = True

# Database
# https://docs.djangoproject.com/en/1.6/ref/settings/#databases

DATABASES['default'] = {'ENGINE': 'django.db.backends.sqlite3',
                        'NAME': os.path.join(BASE_DIR, 'db.sqlite3'),
                        }

# It's fake SECRET_KEY for development
SECRET_KEY = '1234m9$&@h7yxsdgsdew5bx(%+1qrc%7543axyx&r%#m1_te9a'
