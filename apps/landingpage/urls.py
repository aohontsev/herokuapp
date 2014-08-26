from django.conf.urls import patterns, url

import views


urlpatterns = patterns('',
    url('^$', views.index, name='landingpage'),
)