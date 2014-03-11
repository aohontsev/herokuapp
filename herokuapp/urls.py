from django.conf.urls import patterns, include, url
from herokuapp import views

from django.contrib import admin
admin.autodiscover()

urlpatterns = patterns('',
    # Examples:
    # url(r'^blog/', include('blog.urls')),

    url(r'^$', views.index, name='index'),
    url(r'^admin/', include(admin.site.urls)),
    url(r'^sunflower/', views.sunflower, name='sunflower'),
)
