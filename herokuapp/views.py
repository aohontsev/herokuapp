# -*- coding: utf-8 -*-
__author__ = 'aohontsev'

from django.http import HttpResponse


def index(request):
    return HttpResponse("Капуста я тебя люблю!!!")