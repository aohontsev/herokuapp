from django.conf.urls import patterns, url

import views


urlpatterns = patterns('',
    url('^sveta/$', views.index, name='sveta'),
)
