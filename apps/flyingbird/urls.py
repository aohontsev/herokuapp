from django.conf.urls import patterns, url

import views


urlpatterns = patterns('',
    url('^flyingbird/$', views.index, name='flyingbird'),
)