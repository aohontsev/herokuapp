from django.conf.urls import patterns, url

import views


urlpatterns = patterns('',
    url('^sunflower/$', views.index, name='sunflower'),
)
