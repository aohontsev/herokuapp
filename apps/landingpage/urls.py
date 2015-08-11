from django.conf.urls import patterns, url

import views


urlpatterns = patterns('',
    url('^$', views.index, name='landingpage'),
    url('^v1\.98/js/lib\.js', views.lib_js),
    url('^v1\.98/js/tr-url\.js', views.tr_url_js),
    url('^api/v1/tr/translate', views.translate),

)
